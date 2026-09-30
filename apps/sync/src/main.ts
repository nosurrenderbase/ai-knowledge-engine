import {setTimeout as delay} from 'node:timers/promises';
import {loadConfig} from './config.ts';
import {Git} from './git.ts';
import {defaultClaude, readQueue, runJob, type JobDeps} from './job.ts';
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

  const worker = new Worker({
    cfg,
    log,
    alert,
    now,
    remoteHead: () => code.remoteHead(cfg.codeRemote, cfg.codeBranch),
    readQueue: () => readQueue(cfg),
    runJob: job => runJob(job, jobDeps),
  });

  if (process.argv[2] === 'once') {
    const result = await worker.tick();
    log('info', 'tek tur bitti', {result});
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
}

main().catch(e => {
  jsonLogger('error', 'kbsync çöktü', {error: (e as Error).stack ?? String(e)});
  process.exit(1);
});
