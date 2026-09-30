/**
 * Starts the MCP server.
 *
 *   MCP_TOKEN=… node src/main.ts        # http://127.0.0.1:8787/mcp
 *
 * Reads REDIS_*, VOYAGE_*, SEARCH_INDEX like the rest of the repo (.env).
 */
import {createClient} from 'redis';
import {EmbeddingCache, loadDotEnv, loadSearchConfig, Voyage} from '@ai-knowledge-engine/search';
import {createHttpServer} from './http.ts';
import {KbStore} from './kb-store.ts';

const log = (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => {
  process.stderr.write(JSON.stringify({time: new Date().toISOString(), level, msg, ...fields}) + '\n');
};

await loadDotEnv(process.env);
const token = process.env.MCP_TOKEN?.trim();
if (!token) {
  log('error', 'MCP_TOKEN tanımlı değil');
  process.exit(1);
}
const cfg = loadSearchConfig(process.env);
const client = createClient({url: cfg.redisUrl, password: cfg.redisPassword});
client.on('error', e => log('warn', 'redis bağlantı hatası', {error: (e as Error).message}));
// Not awaited: listen right away (health reports 503) and let the client keep retrying.
client.connect().catch(e => log('warn', 'redis bağlanamadı', {error: (e as Error).message}));

const services = {
  store: new KbStore(client, cfg.target),
  search: {
    client,
    voyage: new Voyage(cfg.voyage),
    spec: cfg.target,
    model: cfg.target.model,
    // Query embeddings in memory: the same question twice costs one call.
    queryCache: new EmbeddingCache(null, cfg.target.model, 'query'),
  },
};

const port = Number(process.env.MCP_PORT ?? 8787);
const host = process.env.MCP_HOST ?? '127.0.0.1';
const server = createHttpServer(services, {token, log, ready: () => client.isReady});
server.listen(port, host, () => log('info', 'mcp dinliyor', {url: `http://${host}:${port}/mcp`, index: cfg.target.name}));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    void client.quit().finally(() => process.exit(0));
  });
}
