/**
 * Integration tests against the local Redis (compose.yaml). Each run uses its
 * own index name and removes it afterwards; skipped when Redis is unreachable.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {createClient} from 'redis';
import {loadDotEnv, loadSearchConfig} from '../src/config.ts';
import {EmbeddingCache} from '../src/embedding-cache.ts';
import {hashesKey, readMeta, syncIndex, type IndexTarget} from '../src/indexer.ts';
import {search, type SearchContext} from '../src/search.ts';
import {dropIndex, type RedisClient} from '../src/search-index.ts';
import type {Embedder, InputType} from '../src/voyage.ts';

const DIM = 16;

/** Deterministic bag-of-words vectors: texts sharing words point the same way. */
class FakeEmbedder implements Embedder {
  calls: {texts: string[]; inputType: InputType}[] = [];
  async embed(_model: string, texts: string[], inputType: InputType) {
    this.calls.push({texts, inputType});
    const vectors = texts.map(t => {
      const v = new Float32Array(DIM);
      for (const w of t.toLowerCase().split(/\W+/u).filter(Boolean)) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % DIM] += 1;
      }
      v[0] += 0.01;
      return v;
    });
    return {vectors, tokens: texts.reduce((a, t) => a + t.length, 0)};
  }
  get embedded() {
    return this.calls.filter(c => c.inputType === 'document').flatMap(c => c.texts).length;
  }
}

const doc = (meta: string, body: string) => `---\n${meta}\n---\n\n${body}\n`;

function writeArea(dir: string): void {
  const files: Record<string, string> = {
    'flows/pvp/gunluk-hak.md': doc(
      'type: flow\nmodule: pvp-match\ntitle: PvP günlük hak\nstatus: canlıda\naliases: ["pvp hakkı"]',
      '# PvP günlük hak\n\n## Kurallar\n\nOyuncu günde üç PvP maçı oynar.\n\n## Hatalar\n\nLimit dolunca PVP_DAILY_LIMIT_REACHED döner.',
    ),
    'flows/lig/odul.md': doc('type: flow\nmodule: league\ntitle: Lig ödülü\nstatus: canlıda', '# Lig ödülü\n\n## Ödül\n\nLig sonunda para ödülü dağıtılır.'),
    'flows/pvp/eski-bonus.md': doc(
      'type: flow\nmodule: pvp-match\ntitle: Reklamla PvP bonusu\nstatus: kaldırıldı',
      '# Reklamla PvP bonusu\n\n## Kural\n\nReklam izleyen oyuncuya üç PvP maçı daha verilirdi.',
    ),
    'modules/pvp-match.md': doc('type: module\nmodule: pvp-match\ntitle: PvP modülü', '# PvP\n\n## Ne yapar\n\nOyuncuya karşı maç.'),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true});
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

describe('syncIndex + search (Redis)', async () => {
  await loadDotEnv(process.env);
  const cfg = process.env.REDIS_PASSWORD ? loadSearchConfig({...process.env, VOYAGE_API_KEY: 'x', VOYAGE_API_URL: 'x'}) : null;
  let client: RedisClient | null = null;
  if (cfg) {
    const c = createClient({url: cfg.redisUrl, password: cfg.redisPassword, socket: {connectTimeout: 2000, reconnectStrategy: false}});
    try {
      await c.connect();
      client = c;
    } catch {
      client = null;
    }
  }
  const skip = client ? false : 'yerel Redis yok (docker compose up -d)';

  const name = `test:${process.pid}:${Date.now()}`;
  const target: IndexTarget = {name, prefix: `${name}:c:`, dimension: DIM, model: 'fake-model'};
  let area: string;
  let cacheDir: string;
  const embedder = new FakeEmbedder();
  const sync = (overrides: Partial<Parameters<typeof syncIndex>[0]> = {}) =>
    syncIndex({client: client!, voyage: embedder, target, areaDir: area, commit: 'c1', cacheDir, ...overrides});
  const ctx = (): SearchContext => ({client: client!, voyage: embedder, spec: target, model: target.model});
  const waitIndexed = async () => {
    for (;;) {
      const info = (await client!.sendCommand(['FT.INFO', target.name])) as unknown[];
      if (Number(info[info.indexOf('percent_indexed') + 1]) >= 1) return;
      await new Promise(r => setTimeout(r, 50));
    }
  };

  before(() => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'search-area-'));
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-cache-'));
    writeArea(area);
  });
  after(async () => {
    if (client) {
      await dropIndex(client, target);
      for await (const keys of client.scanIterator({MATCH: `${name}*`, COUNT: 500})) if (keys.length) await client.del(keys);
      await client.quit();
    }
    fs.rmSync(area, {recursive: true, force: true});
    fs.rmSync(cacheDir, {recursive: true, force: true});
  });

  it('indexes every chunk the first time and records the commit', {skip}, async () => {
    const res = await sync();
    assert.equal(res.written, res.total);
    assert.equal(res.removed, 0);
    assert.equal(embedder.embedded, res.total);
    const meta = await readMeta(client!, target);
    assert.equal(meta.commit, 'c1');
    assert.equal(meta.model, 'fake-model');
    assert.equal(Object.keys(await client!.hGetAll(hashesKey(target))).length, res.total);
  });

  it('does nothing when nothing changed', {skip}, async () => {
    const before = embedder.embedded;
    const res = await sync({commit: 'c2'});
    assert.equal(res.written, 0);
    assert.equal(res.tokens, 0);
    assert.equal(embedder.embedded, before);
    assert.equal((await readMeta(client!, target)).commit, 'c2');
  });

  it('re-embeds only the changed section and drops removed documents', {skip}, async () => {
    const before = embedder.embedded;
    const file = path.join(area, 'flows/pvp/gunluk-hak.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('günde üç', 'günde beş'));
    fs.rmSync(path.join(area, 'flows/lig/odul.md'));
    const res = await sync();
    assert.equal(res.written, 1);
    assert.equal(res.removed, 1);
    assert.equal(embedder.embedded - before, 1);
    assert.equal(await client!.exists(`${target.prefix}flows/lig/odul.md#Ödül`), 0);
  });

  it('finds documents by words and meaning, skipping removed ones unless asked', {skip}, async () => {
    await waitIndexed();
    const hits = await search(ctx(), 'günde kaç pvp maçı');
    assert.equal(hits[0].path, 'flows/pvp/gunluk-hak.md');
    assert.equal(hits[0].section, 'Kurallar');
    assert.match(hits[0].text, /günde beş/);
    assert.ok(!hits.some(h => h.path === 'flows/pvp/eski-bonus.md'));

    const withRemoved = await search(ctx(), 'reklam izleyen oyuncuya pvp maçı', {filters: {includeRemoved: true}});
    assert.equal(withRemoved[0].path, 'flows/pvp/eski-bonus.md');
    assert.equal(withRemoved[0].status, 'kaldırıldı');
  });

  it('filters by module and limits sections per document', {skip}, async () => {
    const onlyModule = await search(ctx(), 'pvp maç oyuncu', {filters: {module: 'pvp-match', kind: 'module'}});
    assert.deepEqual([...new Set(onlyModule.map(h => h.path))], ['modules/pvp-match.md']);
    const perDoc = await search(ctx(), 'pvp günlük hak limit hata', {perDoc: 1});
    assert.equal(perDoc.filter(h => h.path === 'flows/pvp/gunluk-hak.md').length, 1);
  });

  it('rebuilds from the embedding cache without paying again when Redis loses the index', {skip}, async () => {
    await dropIndex(client!, target);
    for await (const keys of client!.scanIterator({MATCH: `${name}*`, COUNT: 500})) if (keys.length) await client!.del(keys);
    const res = await sync();
    assert.equal(res.written, res.total);
    assert.equal(res.tokens, 0);
  });

  it('starts over when the model changes', {skip}, async () => {
    const res = await sync({target: {...target, model: 'fake-model-2'}});
    assert.equal(res.rebuilt, true);
    assert.equal((await readMeta(client!, target)).model, 'fake-model-2');
  });
});

describe('EmbeddingCache', () => {
  it('round-trips vectors, prunes unused keys and persists atomically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
    const c = new EmbeddingCache(dir, 'm', 'document');
    c.set('a', Float32Array.from([1, 2, 3]));
    c.set('b', Float32Array.from([4]));
    c.retain(new Set(['a']));
    c.save();
    const again = new EmbeddingCache(dir, 'm', 'document');
    assert.deepEqual([...again.get('a')!], [1, 2, 3]);
    assert.equal(again.get('b'), undefined);
    assert.ok(!fs.existsSync(path.join(dir, 'm.document.json.tmp')));
    fs.rmSync(dir, {recursive: true});
  });
});
