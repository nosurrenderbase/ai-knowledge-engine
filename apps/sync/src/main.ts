import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from 'redis';
import {loadSearchConfig, searchConfigured, Voyage} from '@ai-knowledge-engine/search';
import {loadConfig} from './config.ts';
import {Git} from './git.ts';
import {defaultClaude, readQueue, runJob, type JobDeps} from './job.ts';
import {KbIndexer} from './kb-index.ts';
import {jsonLogger, makeAlerter} from './log.ts';
import {Worker} from './worker.ts';

/**
 * kbsync            → runs forever: poll, process the queue one job at a time
 * kbsync once       → processes the queue once and exits (with DRY_RUN=1: commits locally, no push)
 */
async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const log = jsonLogger;
  const alert = makeAlerter(log, cfg.alertWebhookUrl);
  const now = () => new Date();
  const jobDeps: JobDeps = {cfg, log, now, claude: defaultClaude(cfg)};
  const code = new Git(cfg.codeRepo);

  // Search index: only when Redis and Voyage are configured, never in dry runs
  // (indexing resets the knowledge base clone, which would drop the local commit).
  let indexer: KbIndexer | null = null;
  let closeRedis = async () => {};
  if (!cfg.dryRun && searchConfigured(process.env)) {
    const search = loadSearchConfig(process.env, cfg.area);
    const client = createClient({url: search.redisUrl, password: search.redisPassword});
    client.on('error', e => log('warn', 'redis bağlantı hatası', {error: (e as Error).message}));
    await client.connect();
    closeRedis = async () => void (await client.quit());
    indexer = new KbIndexer({cfg, client, embedder: new Voyage(search.voyage), target: search.target, cacheDir: search.cacheDir, log, alert});
  } else {
    log('info', 'arama indeksi kapalı', {reason: cfg.dryRun ? 'DRY_RUN' : 'VOYAGE_API_KEY / VOYAGE_API_URL / REDIS_PASSWORD eksik'});
  }

  const worker = new Worker({
    cfg,
    log,
    alert,
    now,
    remoteHead: () => code.remoteHead(cfg.codeRemote, cfg.codeBranch),
    readQueue: () => readQueue(cfg),
    runJob: job => runJob(job, jobDeps),
    afterTick: async () => indexer?.reconcile(),
  });

  if (process.argv[2] === 'once') {
    const result = await worker.tick();
    const index = await indexer?.reconcile();
    log('info', 'tek tur bitti', {result, index});
    await closeRedis();
    process.exitCode = result.kind === 'idle' || result.kind === 'drained' ? 0 : 1;
    return;
  }

  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log('info', 'kapanıyor; süren iş bitince çıkılacak', {signal: sig});
      controller.abort();
    });
  }
  log('info', 'kbsync başladı', {area: cfg.area, pollIntervalMs: cfg.pollIntervalMs, dryRun: cfg.dryRun});
  await worker.run(controller.signal, async (ms, signal) => {
    await delay(ms, undefined, {signal}).catch(() => undefined);
  });
  await closeRedis();
}

main().catch(e => {
  jsonLogger('error', 'kbsync çöktü', {error: (e as Error).stack ?? String(e)});
  process.exit(1);
});
