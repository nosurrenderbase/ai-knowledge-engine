/**
 * The knowledge base as a 3D map: every indexed chunk's 1024-d embedding,
 * projected so that chunks about the same thing sit together (the panel's
 * "Bilgi uzayı" view). Random projection to 96 dimensions keeps cosine
 * neighbourhoods and makes UMAP fast; UMAP then lays the points out in 3D.
 * Seeded, so the same knowledge base gives the same picture.
 *
 * Heavy (tens of seconds for a few thousand chunks): run by the deploy agent
 * on the server when the indexed commits change, stored in Redis, read by the panel.
 */
import {RESP_TYPES} from 'redis';
import {UMAP} from 'umap-js';
import {hashesKey, readMeta} from './indexer.ts';
import type {IndexSpec, RedisClient} from './search-index.ts';

export const GALAXY_KEY = 'kb:galaxy:v1';

export interface GalaxyPoint {
  /** Chunk id (unique within its area). */
  id: string;
  area: string;
  path: string;
  title: string;
  module: string;
  kind: string;
  section: string;
  x: number;
  y: number;
  z: number;
}

export interface Galaxy {
  /** "backend@abc123,frontend@…": the indexed commits it was computed from. */
  source: string;
  computedAt: string;
  ms: number;
  points: GalaxyPoint[];
}

type Meta = Omit<GalaxyPoint, 'x' | 'y' | 'z'>;

/** Every chunk of an area with its vector, straight from the search index. */
export async function loadVectors(client: RedisClient, spec: IndexSpec, area: string): Promise<{meta: Meta[]; vectors: Float32Array[]}> {
  const ids = Object.keys((await client.hGetAll(hashesKey(spec))) as Record<string, string>).sort();
  const raw = client.withTypeMapping({[RESP_TYPES.BLOB_STRING]: Buffer});
  const meta: Meta[] = [];
  const vectors: Float32Array[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    // Plain commands (auto-pipelined); a MULTI would not apply the Buffer type mapping.
    const rows = (await Promise.all(batch.map(id => raw.hmGet(spec.prefix + id, ['vec', 'path', 'title', 'module', 'kind', 'headings'])))) as unknown as (Buffer | null)[][];
    rows.forEach((r, j) => {
      if (!r?.[0]) return;
      const b = r[0];
      vectors.push(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
      const s = (k: number) => r[k]?.toString('utf8') ?? '';
      meta.push({id: batch[j], area, path: s(1), title: s(2), module: s(3), kind: s(4), section: s(5)});
    });
  }
  return {meta, vectors};
}

/** Deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian random projection to `dims` dimensions (keeps angles, so cosine neighbourhoods). */
export function project(vectors: Float32Array[], dims: number, random: () => number): number[][] {
  const d = vectors[0]?.length ?? 0;
  const gauss = () => Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
  const R = Array.from({length: dims}, () => Float32Array.from({length: d}, gauss));
  return vectors.map(v => {
    let norm = 0;
    for (let i = 0; i < d; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    return R.map(r => {
      let s = 0;
      for (let i = 0; i < d; i++) s += r[i] * v[i];
      return s / norm / Math.sqrt(dims);
    });
  });
}

/** 3D layout, centred and scaled into a unit ball. */
export function layout(vectors: Float32Array[], seed = 7): [number, number, number][] {
  if (vectors.length < 4) return vectors.map(() => [0, 0, 0]);
  const random = seeded(seed);
  const reduced = project(vectors, Math.min(96, vectors[0].length), random);
  const umap = new UMAP({nComponents: 3, nNeighbors: Math.min(15, vectors.length - 1), minDist: 0.12, spread: 1.1, nEpochs: 250, random, distanceFn: cosine});
  const out = umap.fit(reduced) as number[][];
  const c = [0, 1, 2].map(k => out.reduce((s, p) => s + p[k], 0) / out.length);
  const r = Math.max(...out.map(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]))) || 1;
  return out.map(p => [(p[0] - c[0]) / r, (p[1] - c[1]) / r, (p[2] - c[2]) / r]);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na * nb) || 1);
}

/**
 * Recomputes the map when the indexed commits changed; returns null when it is current.
 * `areas`: area name → its index spec.
 */
export async function updateGalaxy(client: RedisClient, areas: [string, IndexSpec][], force = false): Promise<Galaxy | null> {
  const metas = await Promise.all(areas.map(([, spec]) => readMeta(client, spec)));
  const source = areas.map(([a], i) => `${a}@${metas[i].commit ?? '-'}`).join(',');
  if (!force && (await client.hGet(GALAXY_KEY, 'source')) === source) return null;
  const t = performance.now();
  const all: {meta: Meta[]; vectors: Float32Array[]} = {meta: [], vectors: []};
  for (const [area, spec] of areas) {
    const {meta, vectors} = await loadVectors(client, spec, area);
    all.meta.push(...meta);
    all.vectors.push(...vectors);
  }
  const xyz = layout(all.vectors);
  const galaxy: Galaxy = {
    source,
    computedAt: new Date().toISOString(),
    ms: Math.round(performance.now() - t),
    points: all.meta.map((m, i) => ({...m, x: round(xyz[i][0]), y: round(xyz[i][1]), z: round(xyz[i][2])})),
  };
  await client.hSet(GALAXY_KEY, {source, data: JSON.stringify(galaxy)});
  return galaxy;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export async function readGalaxy(client: RedisClient): Promise<Galaxy | null> {
  const data = await client.hGet(GALAXY_KEY, 'data');
  return data ? (JSON.parse(data) as Galaxy) : null;
}
