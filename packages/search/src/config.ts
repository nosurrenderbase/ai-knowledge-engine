import * as path from 'node:path';
import type {IndexTarget} from './indexer.ts';
import type {VoyageConfig} from './voyage.ts';

type Env = Record<string, string | undefined>;

/** The repo root (packages/search/src → repo). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export interface SearchConfig {
  redisUrl: string;
  redisPassword: string | undefined;
  voyage: VoyageConfig;
  target: IndexTarget;
  cacheDir: string;
}

export function searchConfigured(env: Env): boolean {
  return Boolean(env.VOYAGE_API_KEY && env.VOYAGE_API_URL && env.REDIS_PASSWORD);
}

export function loadSearchConfig(env: Env, area = 'backend'): SearchConfig {
  for (const key of ['VOYAGE_API_KEY', 'VOYAGE_API_URL']) {
    if (!env[key]) throw new Error(`${key} tanımlı değil`);
  }
  const dimension = Number(env.EMBED_DIM ?? 1024);
  const name = env.SEARCH_INDEX ?? `kb:${area}`;
  return {
    redisUrl: env.REDIS_URL ?? `redis://${env.REDIS_HOST ?? '127.0.0.1'}:${env.REDIS_PORT ?? '6380'}`,
    redisPassword: env.REDIS_PASSWORD,
    voyage: {apiKey: env.VOYAGE_API_KEY!, baseUrl: env.VOYAGE_API_URL!, dimension},
    target: {name, prefix: `${name}:c:`, dimension, model: env.VOYAGE_MODEL ?? 'voyage-4-large'},
    cacheDir: path.resolve(env.EMBEDDINGS_CACHE_DIR ?? path.join(REPO_ROOT, 'work/embeddings')),
  };
}

/** Loads KEY=value lines of the repo's .env into `env` without overriding what is set. */
export async function loadDotEnv(env: Env, file = path.join(REPO_ROOT, '.env')): Promise<void> {
  const fs = await import('node:fs');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
