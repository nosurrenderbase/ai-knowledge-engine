/**
 * Hybrid search over the knowledge base: Turkish full-text (BM25) and vector
 * search run side by side and are merged with weighted reciprocal rank fusion.
 */
import {EmbeddingCache} from './embedding-cache.ts';
import {escapeTag, rrf, searchText, searchVector, type Hit, type IndexSpec, type RedisClient} from './search-index.ts';
import type {Embedder} from './voyage.ts';

export interface Fusion {
  /** RRF constant: lower values reward the top ranks more. */
  k: number;
  textWeight: number;
  vectorWeight: number;
  /** How many hits each list contributes. */
  depth: number;
}

/**
 * Chosen on the genel-bakis question set with voyage-4-large (eval/retrieval.ts):
 * right document first for 90.4% of questions, in the top 5 for 100%. The
 * neighbouring settings score the same, so this is not tuned to one lucky point.
 */
export const DEFAULT_FUSION: Fusion = {k: 20, textWeight: 1, vectorWeight: 2, depth: 30};

export interface SearchFilters {
  module?: string;
  /** flow, module, usecase, overview, infra, … */
  kind?: string;
  /** Documents with status "kaldırıldı" are left out unless this is set. */
  includeRemoved?: boolean;
}

export function filterQuery(f: SearchFilters = {}): string {
  const parts: string[] = [];
  if (!f.includeRemoved) parts.push(`-@status:{${escapeTag('kaldırıldı')}}`);
  if (f.module) parts.push(`@module:{${escapeTag(f.module)}}`);
  if (f.kind) parts.push(`@kind:{${escapeTag(f.kind)}}`);
  return parts.join(' ');
}

export interface SearchHit {
  /** Document path relative to the area, e.g. flows/pvp/gunluk-hak.md. */
  path: string;
  title: string;
  kind: string;
  module: string;
  status: string;
  /** Section the chunk comes from ("Kurallar › Hata kodları"). */
  section: string;
  /** Section text, for a first look; read the whole document for the answer. */
  text: string;
  score: number;
}

export interface SearchContext {
  client: RedisClient;
  voyage: Embedder;
  spec: IndexSpec;
  model: string;
  fusion?: Fusion;
  /** Optional query embedding cache (repeated questions cost nothing). */
  queryCache?: EmbeddingCache;
}

export async function hybridHits(ctx: SearchContext, question: string, filters: SearchFilters = {}): Promise<Hit[]> {
  const fusion = ctx.fusion ?? DEFAULT_FUSION;
  let vector = ctx.queryCache?.get(question);
  if (!vector) {
    vector = (await ctx.voyage.embed(ctx.model, [question], 'query')).vectors[0];
    ctx.queryCache?.set(question, vector);
  }
  const filter = filterQuery(filters);
  const [text, vec] = await Promise.all([
    searchText(ctx.client, ctx.spec, question, fusion.depth, filter),
    searchVector(ctx.client, ctx.spec, vector, fusion.depth, filter),
  ]);
  return rrf([text, vec], fusion.k, [fusion.textWeight, fusion.vectorWeight]);
}

const FIELDS = ['path', 'title', 'kind', 'module', 'status', 'headings', 'text'];

/**
 * Searches and returns the best sections, at most `perDoc` per document, so a
 * long document does not crowd out the others.
 */
export async function search(
  ctx: SearchContext,
  question: string,
  opts: {limit?: number; perDoc?: number; filters?: SearchFilters} = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 8;
  const perDoc = opts.perDoc ?? 2;
  const hits = await hybridHits(ctx, question, opts.filters);
  const out: SearchHit[] = [];
  const perDocCount = new Map<string, number>();
  for (const hit of hits) {
    if (out.length >= limit) break;
    const [path, title, kind, module, status, headings, text] = (await ctx.client.hmGet(hit.key, FIELDS)) as (string | null)[];
    if (!path) continue;
    // 'yok' only fills the TAG field for documents without a status; do not show it.
    const f = {path, title: title ?? '', kind: kind ?? '', module: module ?? '', status: status && status !== 'yok' ? status : '', headings: headings ?? '', text: text ?? ''};
    const n = perDocCount.get(f.path) ?? 0;
    if (n >= perDoc) continue;
    perDocCount.set(f.path, n + 1);
    out.push({
      path: f.path,
      title: f.title,
      kind: f.kind,
      module: f.module,
      status: f.status,
      section: f.headings,
      text: f.text,
      score: Math.round(hit.score * 10000) / 10000,
    });
  }
  return out;
}
