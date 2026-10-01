import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from 'redis';
import {loadSearchConfig, searchConfigured, Voyage} from '@ai-knowledge-engine/search';
import {areaLabel} from '@ai-knowledge-engine/kb';
import {loadAreaConfigs, type Config} from './config.ts';
import {Git} from './git.ts';
import {defaultClaude, readQueue, runJob} from './job.ts';
import {KbIndexer} from './kb-index.ts';
import {jsonLogger, makeAlerter, type Logger} from './log.ts';
import {runWorkers, Worker} from './worker.ts';

/**
 * kbsync            → runs forever: poll, process each area's queue one job at a time
 * kbsync once       → processes the queues once and exits (with DRY_RUN=1: commits locally, no push)
 *
 * Areas: backend (CODE_REPO) always, frontend (FRONTEND_REPO) when set.
 */
async function main(): Promise<void> {
  const configs = loadAreaConfigs(process.env);
  const base = configs[0];
  const alert = makeAlerter(jsonLogger, base.alertWebhookUrl);
  const now = () => new Date();

  // Search index: only when Redis and Voyage are configured, never in dry runs
  // (indexing resets the knowledge base clone, which would drop the local commit).
  const indexing = !base.dryRun && searchConfigured(process.env);
  let redis: ReturnType<typeof createClient> | null = null;
  if (indexing) {
    const search = loadSearchConfig(process.env);
    redis = createClient({url: search.redisUrl, password: search.redisPassword});
    redis.on('error', e => jsonLogger('warn', 'redis bağlantı hatası', {error: (e as Error).message}));
    // Not awaited: after a reboot Docker (and Redis) may come up after this worker.
    // Syncing starts right away; indexing waits until the client is ready.
    redis.connect().catch(e => jsonLogger('warn', 'redis bağlanamadı', {error: (e as Error).message}));
  } else {
    jsonLogger('info', 'arama indeksi kapalı', {reason: base.dryRun ? 'DRY_RUN' : 'VOYAGE_API_KEY / VOYAGE_API_URL / REDIS_PASSWORD eksik'});
  }

  const workerFor = (cfg: Config): Worker => {
    const log: Logger = (level, msg, fields) => jsonLogger(level, msg, {area: cfg.area, ...fields});
    const code = new Git(cfg.codeRepo);
    let indexer: KbIndexer | null = null;
    if (redis) {
      const search = loadSearchConfig(process.env, cfg.area);
      indexer = new KbIndexer({
        cfg,
        client: redis,
        embedder: new Voyage(search.voyage),
        target: search.target,
        cacheDir: search.cacheDir,
        label: areaLabel(cfg.area),
        log,
        alert,
      });
    }
    return new Worker({
      cfg,
      log,
      alert,
      now,
      remoteHead: () => code.remoteHead(cfg.codeRemote, cfg.codeBranch),
      readQueue: () => readQueue(cfg),
      runJob: job => runJob(job, {cfg, log, now, claude: defaultClaude(cfg)}),
      afterTick: async () => indexer?.reconcile(),
    });
  };
  const workers = configs.map(workerFor);
  const closeRedis = async () => void (await redis?.quit());

  if (process.argv[2] === 'once') {
    let ok = true;
    for (const w of workers) {
      const result = await w.tick();
      await w.afterTick();
      jsonLogger('info', 'tek tur bitti', {result});
      ok &&= result.kind === 'idle' || result.kind === 'drained';
    }
    await closeRedis();
    process.exitCode = ok ? 0 : 1;
    return;
  }

  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      jsonLogger('info', 'kapanıyor; süren iş bitince çıkılacak', {signal: sig});
      controller.abort();
    });
  }
  jsonLogger('info', 'kbsync başladı', {areas: configs.map(c => c.area), pollIntervalMs: base.pollIntervalMs, dryRun: base.dryRun});
  await runWorkers(workers, controller.signal, async (ms, signal) => {
    await delay(ms, undefined, {signal}).catch(() => undefined);
  }, now);
  await closeRedis();
}

main().catch(e => {
  jsonLogger('error', 'kbsync çöktü', {error: (e as Error).stack ?? String(e)});
  process.exit(1);
});
