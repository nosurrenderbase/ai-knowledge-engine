/**
 * Connections the panel shares across requests: Postgres (accounts, usage)
 * and Redis (search index). Created once per server process.
 */
import {createDb, databaseUrl, migrate, type Db} from '@ai-knowledge-engine/accounts';
import {EmbeddingCache, loadDotEnv, loadSearchConfig, Voyage, type SearchConfig, type SearchContext} from '@ai-knowledge-engine/search';
import {createClient} from 'redis';

export const AREAS = ['backend', 'frontend'] as const;
export type AreaName = (typeof AREAS)[number];

export interface Services {
  db: Db;
  redis: ReturnType<typeof createClient>;
  cfg: SearchConfig;
  /** Search context per knowledge base area (each has its own index). */
  areas: Record<AreaName, SearchContext>;
}

const g = globalThis as unknown as {__kbPanel?: Promise<Services>};

async function init(): Promise<Services> {
  await loadDotEnv(process.env);
  const db = createDb({url: databaseUrl(process.env)});
  await migrate(db);
  const cfg = loadSearchConfig(process.env);
  const redis = createClient({url: cfg.redisUrl, password: cfg.redisPassword});
  redis.on('error', e => console.error('redis', (e as Error).message));
  await redis.connect();
  const voyage = new Voyage(cfg.voyage);
  const queryCache = new EmbeddingCache(null, cfg.target.model, 'query');
  const context = (area: AreaName): SearchContext => {
    const target = loadSearchConfig(process.env, area).target;
    return {client: redis, voyage, spec: target, model: target.model, queryCache};
  };
  const areas: Record<AreaName, SearchContext> = {backend: context('backend'), frontend: context('frontend')};
  return {db, redis, cfg, areas};
}

export function services(): Promise<Services> {
  g.__kbPanel ??= init().catch(e => {
    g.__kbPanel = undefined;
    throw e;
  });
  return g.__kbPanel;
}
