/**
 * Starts the MCP server.
 *
 *   node src/main.ts        # http://127.0.0.1:8787/mcp
 *
 * Reads REDIS_*, VOYAGE_*, SEARCH_INDEX, DATABASE_URL / POSTGRES_* like the
 * rest of the repo (.env). People authenticate with their own tokens
 * (npm run users); MCP_TOKEN, if set, is the old shared token, kept for the
 * switch-over and recorded as its own "user".
 */
import {timingSafeEqual} from 'node:crypto';
import {createClient} from 'redis';
import {addUser, createDb, databaseUrl, findUser, migrate, purgeUsage, recordUsage, verifyToken, type Principal} from '@ai-knowledge-engine/accounts';
import {EmbeddingCache, loadDotEnv, loadSearchConfig, Voyage} from '@ai-knowledge-engine/search';
import {createHttpServer} from './http.ts';
import {KbStore} from './kb-store.ts';

type Level = 'info' | 'warn' | 'error';
const log = (level: Level, msg: string, fields?: Record<string, unknown>) => {
  process.stderr.write(JSON.stringify({time: new Date().toISOString(), level, msg, ...fields}) + '\n');
};

await loadDotEnv(process.env);
const cfg = loadSearchConfig(process.env);
const retentionDays = Number(process.env.USAGE_RETENTION_DAYS ?? 90);
const sharedToken = process.env.MCP_TOKEN?.trim() || null;
const LEGACY_EMAIL = 'ortak-token@efsanebaskan.local';

// Neither store is awaited: after a reboot they may come up after this process.
// Until both are ready, /health is 503 and /mcp answers "try again".
const redis = createClient({url: cfg.redisUrl, password: cfg.redisPassword});
redis.on('error', e => log('warn', 'redis bağlantı hatası', {error: (e as Error).message}));
redis.connect().catch(e => log('warn', 'redis bağlanamadı', {error: (e as Error).message}));

const db = createDb({url: databaseUrl(process.env)});
db.on('error', e => log('warn', 'postgres bağlantı hatası', {error: e.message}));
let dbReady = false;
let legacy: Principal | null = null;

async function prepareDb(): Promise<void> {
  for (;;) {
    try {
      const applied = await migrate(db);
      if (applied.length) log('info', 'veritabanı şeması güncellendi', {applied});
      if (sharedToken) {
        const u = (await findUser(db, LEGACY_EMAIL)) ?? (await addUser(db, {name: 'Ortak token (geçici)', email: LEGACY_EMAIL}));
        legacy = u.disabledAt ? null : {userId: u.id, tokenId: 0, name: u.name};
      }
      dbReady = true;
      return;
    } catch (e) {
      log('warn', 'veritabanı hazır değil, tekrar denenecek', {error: (e as Error).message});
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
void prepareDb();

function isShared(token: string): boolean {
  if (!sharedToken) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(sharedToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function purge(): Promise<void> {
  if (!dbReady) return;
  try {
    const n = await purgeUsage(db, retentionDays);
    if (n) log('info', 'eski kullanım kayıtları silindi', {rows: n, retentionDays});
  } catch (e) {
    log('warn', 'kullanım kayıtları temizlenemedi', {error: (e as Error).message});
  }
}
setInterval(purge, 60 * 60_000).unref();
setTimeout(purge, 60_000).unref();

const services = {
  store: new KbStore(redis, cfg.target),
  search: {
    client: redis,
    voyage: new Voyage(cfg.voyage),
    spec: cfg.target,
    model: cfg.target.model,
    // Query embeddings in memory: the same question twice costs one call.
    queryCache: new EmbeddingCache(null, cfg.target.model, 'query'),
  },
  usage: (e: Parameters<typeof recordUsage>[1]) => recordUsage(db, {...e, tokenId: e.tokenId || null}),
  log,
};

const port = Number(process.env.MCP_PORT ?? 8787);
const host = process.env.MCP_HOST ?? '127.0.0.1';
const server = createHttpServer(services, {
  log,
  ready: () => redis.isReady && dbReady,
  authenticate: async token => (isShared(token) ? legacy : verifyToken(db, token)),
});
server.listen(port, host, () => log('info', 'mcp dinliyor', {url: `http://${host}:${port}/mcp`, index: cfg.target.name, sharedToken: Boolean(sharedToken)}));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    void Promise.allSettled([redis.quit(), db.end()]).finally(() => process.exit(0));
  });
}
