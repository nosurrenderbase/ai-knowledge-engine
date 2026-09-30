import pg from 'pg';
import {MIGRATIONS} from './migrations.ts';

export type Db = pg.Pool;

type Env = Record<string, string | undefined>;

/** DATABASE_URL, or the compose Postgres published on localhost. */
export function databaseUrl(env: Env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.POSTGRES_PASSWORD) throw new Error('DATABASE_URL ya da POSTGRES_PASSWORD tanımlı değil');
  const host = env.POSTGRES_HOST ?? '127.0.0.1';
  const port = env.POSTGRES_PORT ?? '5433';
  return `postgres://kb:${encodeURIComponent(env.POSTGRES_PASSWORD)}@${host}:${port}/kb`;
}

export interface DbOptions {
  url: string;
  /** Postgres schema to work in (tests use a throwaway one). */
  schema?: string;
  max?: number;
}

export function createDb(opts: DbOptions): Db {
  return new pg.Pool({
    connectionString: opts.url,
    max: opts.max ?? 5,
    options: opts.schema ? `-c search_path=${opts.schema}` : undefined,
  });
}

/**
 * Applies MIGRATIONS in order, each once, inside one transaction.
 * An advisory lock keeps two processes (MCP, CLI) from migrating at once.
 */
export async function migrate(db: Db): Promise<string[]> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(724301)');
    await client.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query<{version: string}>('select version from schema_migrations')).rows.map(r => r.version));
    const applied: string[] = [];
    for (const {version, sql} of MIGRATIONS) {
      if (done.has(version)) continue;
      await client.query(sql);
      await client.query('insert into schema_migrations (version) values ($1)', [version]);
      applied.push(version);
    }
    await client.query('commit');
    return applied;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
