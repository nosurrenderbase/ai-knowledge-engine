/**
 * Retrieval evaluation: which search setup finds the right document?
 *
 * Ground truth is the "Hangi soru için hangi doküman" table of
 * genel/genel-bakis.md (boss-style questions → the document that answers
 * them). genel-bakis itself is left out of the index, since it contains the
 * questions. For each question the chunk hits are folded into a document
 * ranking; a question counts as found at k when one of its documents is in
 * the top k.
 *
 *   node eval/retrieval.ts [--kb ../../work/kb/backend] [--models voyage-4-lite,voyage-4,voyage-4-large]
 *
 * Needs REDIS_PASSWORD, REDIS_PORT, VOYAGE_API_KEY, VOYAGE_API_URL (the repo's .env).
 * Embeddings are cached under work/eval/ so reruns cost nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {parseArgs} from 'node:util';
import {buildChunks, type Chunk} from '@ai-knowledge-engine/kb';
import {createClient} from 'redis';
import {dropIndex, ensureIndex, rrf, searchText, searchVector, upsertChunks, type Hit, type IndexSpec} from '../src/search-index.ts';
import {groundTruth, GROUND_TRUTH_DOC, type Question} from '../src/ground-truth.ts';
import {Voyage} from '../src/voyage.ts';

const REPO = path.resolve(import.meta.dirname, '../../..');
const {values} = parseArgs({
  options: {
    kb: {type: 'string', default: path.join(REPO, 'work/kb/backend')},
    models: {type: 'string', default: 'voyage-4-lite,voyage-4,voyage-4-large'},
    keep: {type: 'boolean', default: false},
  },
});
const AREA = path.resolve(values.kb!);
const MODELS = values.models!.split(',');
const DIM = 1024;
const CACHE_DIR = path.join(REPO, 'work/eval');

function loadEnv(): void {
  const file = path.join(REPO, '.env');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/** Embeddings cache: chunk hash (or query text) → vector, per model and input type. */
class Cache {
  private readonly file: string;
  private readonly data: Record<string, string>;
  constructor(model: string, kind: string) {
    fs.mkdirSync(CACHE_DIR, {recursive: true});
    this.file = path.join(CACHE_DIR, `${model}.${kind}.json`);
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
  }
  get(key: string): Float32Array | undefined {
    const b64 = this.data[key];
    if (!b64) return undefined;
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  set(key: string, v: Float32Array): void {
    this.data[key] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
  }
  save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}

async function embedAll(voyage: Voyage, model: string, kind: 'document' | 'query', items: {key: string; text: string}[]) {
  const cache = new Cache(model, kind);
  const missing = items.filter(i => !cache.get(i.key));
  let tokens = 0;
  if (missing.length) {
    const res = await voyage.embed(model, missing.map(m => m.text), kind);
    missing.forEach((m, i) => cache.set(m.key, res.vectors[i]));
    tokens = res.tokens;
    cache.save();
  }
  return {vectors: items.map(i => cache.get(i.key)!), tokens};
}

/** Folds chunk hits into a document ranking (first occurrence wins). */
function docRanking(hits: Hit[], pathOf: Map<string, string>): string[] {
  const docs: string[] = [];
  for (const h of hits) {
    const d = pathOf.get(h.key);
    if (d && !docs.includes(d)) docs.push(d);
  }
  return docs;
}

interface Score {
  at1: number;
  at3: number;
  at5: number;
  mrr: number;
  misses: string[];
}

function score(questions: Question[], rankings: string[][]): Score {
  let at1 = 0, at3 = 0, at5 = 0, mrr = 0;
  const misses: string[] = [];
  questions.forEach((q, i) => {
    const rank = rankings[i].findIndex(d => q.docs.includes(d));
    if (rank === 0) at1++;
    if (rank >= 0 && rank < 3) at3++;
    if (rank >= 0 && rank < 5) at5++;
    else misses.push(q.text);
    if (rank >= 0 && rank < 10) mrr += 1 / (rank + 1);
  });
  const n = questions.length;
  const pct = (x: number) => Math.round((1000 * x) / n) / 10;
  return {at1: pct(at1), at3: pct(at3), at5: pct(at5), mrr: Math.round((1000 * mrr) / n) / 1000, misses};
}

async function main(): Promise<void> {
  loadEnv();
  const questions = groundTruth(AREA);
  const chunks: Chunk[] = buildChunks(AREA).filter(c => c.path !== GROUND_TRUTH_DOC);
  console.log(`${questions.length} soru, ${chunks.length} parça (${GROUND_TRUTH_DOC} hariç)`);

  const voyage = new Voyage({apiKey: process.env.VOYAGE_API_KEY!, baseUrl: process.env.VOYAGE_API_URL!, dimension: DIM});
  const client = createClient({url: `redis://127.0.0.1:${process.env.REDIS_PORT ?? 6380}`, password: process.env.REDIS_PASSWORD});
  await client.connect();

  const K = 20;
  const results: Record<string, Score> = {};
  const queryVectors: Record<string, Float32Array[]> = {};
  const specs: IndexSpec[] = [];
  let pathOf = new Map<string, string>();

  try {
    for (const model of MODELS) {
      const spec: IndexSpec = {name: `eval:${model}`, prefix: `eval:${model}:`, dimension: DIM};
      specs.push(spec);
      await dropIndex(client, spec);
      await ensureIndex(client, spec);

      const docs = await embedAll(voyage, model, 'document', chunks.map(c => ({key: c.hash, text: c.embed_text})));
      for (let i = 0; i < chunks.length; i += 200) {
        await upsertChunks(client, spec, chunks.slice(i, i + 200), docs.vectors.slice(i, i + 200));
      }
      const queries = await embedAll(voyage, model, 'query', questions.map(q => ({key: q.text, text: q.text})));
      queryVectors[model] = queries.vectors;
      console.log(`${model}: ${docs.tokens + queries.tokens} token harcandı (önbellekte olanlar hariç)`);
      pathOf = new Map(chunks.map(c => [spec.prefix + c.id, c.path]));

      // Redis indexes asynchronously; wait until it has everything.
      for (;;) {
        const info = (await client.sendCommand(['FT.INFO', spec.name])) as unknown[];
        const i = info.indexOf('num_docs');
        if (Number(info[i + 1]) >= chunks.length) break;
        await new Promise(r => setTimeout(r, 200));
      }

      const text: string[][] = [];
      const vector: string[][] = [];
      const hybrid: string[][] = [];
      for (const [qi, q] of questions.entries()) {
        const t = await searchText(client, spec, q.text, K);
        const v = await searchVector(client, spec, queries.vectors[qi], K);
        text.push(docRanking(t, pathOf));
        vector.push(docRanking(v, pathOf));
        hybrid.push(docRanking(rrf([t, v]), pathOf));
      }
      if (!results['yalnız kelime (BM25, Türkçe kök)']) results['yalnız kelime (BM25, Türkçe kök)'] = score(questions, text);
      results[`${model} yalnız vektör`] = score(questions, vector);
      results[`${model} hibrit`] = score(questions, hybrid);
    }

    // The voyage-4 family shares one embedding space: documents from the largest, queries from the smallest.
    if (MODELS.includes('voyage-4-large') && MODELS.includes('voyage-4-lite')) {
      const spec = specs[MODELS.indexOf('voyage-4-large')];
      const map = new Map(chunks.map(c => [spec.prefix + c.id, c.path]));
      const hybrid: string[][] = [];
      for (const [qi, q] of questions.entries()) {
        const t = await searchText(client, spec, q.text, K);
        const v = await searchVector(client, spec, queryVectors['voyage-4-lite'][qi], K);
        hybrid.push(docRanking(rrf([t, v]), map));
      }
      results['doküman large + soru lite, hibrit'] = score(questions, hybrid);
    }

    console.log('\n| Yöntem | İlk 1 | İlk 3 | İlk 5 | MRR@10 |\n|---|---|---|---|---|');
    for (const [name, s] of Object.entries(results)) console.log(`| ${name} | %${s.at1} | %${s.at3} | %${s.at5} | ${s.mrr} |`);
    const best = Object.entries(results).sort((a, b) => b[1].at5 - a[1].at5 || b[1].mrr - a[1].mrr)[0];
    console.log(`\nEn iyi: ${best[0]}. İlk 5'te bulamadığı sorular (${best[1].misses.length}):`);
    for (const m of best[1].misses) console.log(`- ${m}`);
  } finally {
    if (!values.keep) for (const spec of specs) await dropIndex(client, spec);
    await client.quit();
  }
}

await main();
