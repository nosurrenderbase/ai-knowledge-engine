/**
 * Keeps the Redis index equal to the knowledge base on disk: chunks whose hash
 * changed are re-embedded and written, chunks that disappeared are deleted.
 * Idempotent; running it twice in a row does nothing the second time.
 */
import {buildChunks, type Chunk} from '@ai-knowledge-engine/kb';
import {EmbeddingCache} from './embedding-cache.ts';
import {dropIndex, ensureIndex, upsertChunks, type IndexSpec, type RedisClient} from './search-index.ts';
import type {Embedder} from './voyage.ts';

export interface IndexTarget extends IndexSpec {
  model: string;
}

export const metaKey = (spec: IndexSpec) => `${spec.name}:meta`;
export const hashesKey = (spec: IndexSpec) => `${spec.name}:hashes`;

export interface SyncOptions {
  client: RedisClient;
  voyage: Embedder;
  target: IndexTarget;
  /** Knowledge base area directory (e.g. work/kb/backend). */
  areaDir: string;
  /** Knowledge base commit being indexed, recorded in the meta hash. */
  commit: string;
  /** Embedding cache directory; null disables the disk cache. */
  cacheDir: string | null;
  now?: () => Date;
}

export interface SyncResult {
  total: number;
  written: number;
  removed: number;
  /** Tokens paid for (cache hits cost nothing). */
  tokens: number;
  rebuilt: boolean;
}

export async function readMeta(client: RedisClient, spec: IndexSpec): Promise<Record<string, string>> {
  return (await client.hGetAll(metaKey(spec))) as Record<string, string>;
}

/** Deletes the index, its chunk hashes and bookkeeping. */
async function wipe(client: RedisClient, spec: IndexSpec): Promise<void> {
  await dropIndex(client, spec);
  for await (const keys of client.scanIterator({MATCH: `${spec.prefix}*`, COUNT: 500})) {
    if (keys.length) await client.del(keys);
  }
  await client.del([metaKey(spec), hashesKey(spec)]);
}

export async function syncIndex(opts: SyncOptions): Promise<SyncResult> {
  const {client, voyage, target, areaDir} = opts;
  const meta = await readMeta(client, target);
  const rebuilt = Object.keys(meta).length > 0 && (meta.model !== target.model || Number(meta.dimension) !== target.dimension);
  if (rebuilt) await wipe(client, target);
  await ensureIndex(client, target);

  const chunks = buildChunks(areaDir);
  const indexed = (await client.hGetAll(hashesKey(target))) as Record<string, string>;
  const current = new Set(chunks.map(c => c.id));
  const changed: Chunk[] = chunks.filter(c => indexed[c.id] !== c.hash);
  const removed = Object.keys(indexed).filter(id => !current.has(id));

  const cache = new EmbeddingCache(opts.cacheDir, target.model, 'document');
  const missing = changed.filter(c => !cache.get(c.hash));
  let tokens = 0;
  if (missing.length) {
    const res = await voyage.embed(target.model, missing.map(c => c.embed_text), 'document');
    missing.forEach((c, i) => cache.set(c.hash, res.vectors[i]));
    tokens = res.tokens;
  }
  cache.retain(new Set(chunks.map(c => c.hash)));
  cache.save();

  for (let i = 0; i < changed.length; i += 200) {
    const batch = changed.slice(i, i + 200);
    await upsertChunks(client, target, batch, batch.map(c => cache.get(c.hash)!));
  }
  if (changed.length) await client.hSet(hashesKey(target), Object.fromEntries(changed.map(c => [c.id, c.hash])));
  if (removed.length) {
    await client.del(removed.map(id => target.prefix + id));
    await client.hDel(hashesKey(target), removed);
  }
  await client.hSet(metaKey(target), {
    model: target.model,
    dimension: String(target.dimension),
    commit: opts.commit,
    chunks: String(chunks.length),
    updated_at: (opts.now?.() ?? new Date()).toISOString(),
  });
  return {total: chunks.length, written: changed.length, removed: removed.length, tokens, rebuilt};
}
