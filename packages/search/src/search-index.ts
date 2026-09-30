/**
 * The Redis side of the knowledge base index: one HASH per chunk, one
 * RediSearch index with Turkish full-text fields and a vector field.
 * Commands are sent raw so they read exactly like the Redis documentation.
 */
import type {Chunk} from '@ai-knowledge-engine/kb';
import type {createClient} from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

export interface IndexSpec {
  /** RediSearch index name. */
  name: string;
  /** Key prefix of the chunk hashes. */
  prefix: string;
  dimension: number;
}

export function createIndexArgs(spec: IndexSpec): string[] {
  return [
    'FT.CREATE', spec.name,
    'ON', 'HASH',
    'PREFIX', '1', spec.prefix,
    'LANGUAGE', 'turkish',
    'SCHEMA',
    'title', 'TEXT', 'WEIGHT', '3',
    'aliases', 'TEXT', 'WEIGHT', '2',
    'headings', 'TEXT', 'WEIGHT', '2',
    'content', 'TEXT',
    'path', 'TAG',
    'kind', 'TAG',
    'module', 'TAG',
    'status', 'TAG', 'SEPARATOR', '|',
    'vec', 'VECTOR', 'HNSW', '6', 'TYPE', 'FLOAT32', 'DIM', String(spec.dimension), 'DISTANCE_METRIC', 'COSINE',
  ];
}

export async function ensureIndex(client: RedisClient, spec: IndexSpec): Promise<void> {
  const existing = (await client.sendCommand(['FT._LIST'])) as string[];
  if (!existing.includes(spec.name)) await client.sendCommand(createIndexArgs(spec));
}

export async function dropIndex(client: RedisClient, spec: IndexSpec): Promise<void> {
  const existing = (await client.sendCommand(['FT._LIST'])) as string[];
  if (existing.includes(spec.name)) await client.sendCommand(['FT.DROPINDEX', spec.name, 'DD']);
}

const asString = (v: unknown) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v));

export function vectorBytes(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** Hash fields stored for a chunk. `text` is kept for display, not indexed. */
export function chunkFields(chunk: Chunk, vector: Float32Array): Record<string, string | Buffer> {
  return {
    id: chunk.id,
    hash: chunk.hash,
    path: chunk.path,
    kind: chunk.kind,
    module: asString(chunk.meta.module),
    status: asString(chunk.meta.status) || 'yok',
    title: asString(chunk.meta.title),
    aliases: asString(chunk.meta.aliases),
    headings: asString(chunk.meta.headings).replace(/, /g, ' › '),
    content: chunk.embed_text,
    text: chunk.text,
    vec: vectorBytes(vector),
  };
}

export async function upsertChunks(client: RedisClient, spec: IndexSpec, chunks: Chunk[], vectors: Float32Array[]): Promise<void> {
  const multi = client.multi();
  chunks.forEach((chunk, i) => multi.hSet(spec.prefix + chunk.id, chunkFields(chunk, vectors[i])));
  await multi.exec();
}

// Common Turkish question words and particles that carry no search meaning.
const STOPWORDS = new Set(
  (
    'acaba ama ancak bana beni bir biri bu bunu bunun da daha de değil diye en gibi hangi hangisi her hem için ile ise kaç kadar ki kim mi mı mu mü ' +
    'nasıl ne neden nedir nerede neler niye niçin o olan olarak olur oluyor sonra şu ve var veya ya yok zaman'
  ).split(' '),
);

/** RediSearch special characters that must be escaped inside a term. */
const SPECIAL = /[,.<>{}[\]"':;!@#$%^&*()\-+=~|/\\?]/g;

/** Turns a natural-language question into an OR query over its meaningful terms. */
export function textQuery(question: string): string {
  const terms = question
    // Not toLocaleLowerCase('tr'): that turns the I of code names (PVP_DAILY_LIMIT) into ı.
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/[?!.,;:()"“”'’`]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
    .map(t => t.replace(SPECIAL, m => `\\${m}`));
  return [...new Set(terms)].join(' | ');
}

export interface Hit {
  key: string;
  score: number;
}

/** Escapes a value for a TAG query: `@module:{${escapeTag('pvp-match')}}`. */
export function escapeTag(value: string): string {
  return value.replace(/[^\p{L}\p{N}_]/gu, m => `\\${m}`);
}

/** Parses a RESP2 FT.SEARCH reply: [total, key, fields|score, ...]. */
function parseKeys(reply: unknown[], withScores: boolean): Hit[] {
  const hits: Hit[] = [];
  const step = withScores ? 2 : 1;
  for (let i = 1; i < reply.length; i += step) {
    hits.push({key: String(reply[i]), score: withScores ? Number(reply[i + 1]) : 0});
  }
  return hits;
}

export async function searchText(client: RedisClient, spec: IndexSpec, question: string, k: number, filter = ''): Promise<Hit[]> {
  const q = textQuery(question);
  if (!q) return [];
  const reply = (await client.sendCommand([
    'FT.SEARCH', spec.name, filter ? `(${filter}) (${q})` : q,
    'WITHSCORES', 'NOCONTENT', 'LIMIT', '0', String(k), 'DIALECT', '2',
  ])) as unknown[];
  return parseKeys(reply, true);
}

export async function searchVector(client: RedisClient, spec: IndexSpec, vector: Float32Array, k: number, filter = ''): Promise<Hit[]> {
  const reply = (await client.sendCommand([
    'FT.SEARCH', spec.name, `${filter ? `(${filter})` : '*'}=>[KNN ${k} @vec $B AS dist]`,
    'PARAMS', '2', 'B', vectorBytes(vector),
    'SORTBY', 'dist', 'RETURN', '1', 'dist', 'LIMIT', '0', String(k), 'DIALECT', '2',
  ])) as unknown[];
  // With RETURN each hit is [key, [field, value]].
  const hits: Hit[] = [];
  for (let i = 1; i < reply.length; i += 2) {
    const fields = reply[i + 1] as string[];
    hits.push({key: String(reply[i]), score: 1 - Number(fields[1])});
  }
  return hits;
}

/**
 * Reciprocal rank fusion: merges ranked lists; items high in several lists win.
 * `weights` scale each list's contribution (default 1 each).
 */
export function rrf(lists: Hit[][], k = 60, weights: number[] = []): Hit[] {
  const scores = new Map<string, number>();
  lists.forEach((list, li) => {
    const w = weights[li] ?? 1;
    list.forEach((hit, rank) => scores.set(hit.key, (scores.get(hit.key) ?? 0) + w / (k + rank + 1)));
  });
  return [...scores.entries()].map(([key, score]) => ({key, score})).sort((a, b) => b.score - a.score);
}
