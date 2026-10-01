import type {Config} from './config.ts';
import type {Merge} from './git.ts';
import {JobFailed, LimitReached} from './job.ts';
import type {Alerter, Logger} from './log.ts';
import {describeMerges, nextJob, type Job} from './queue.ts';

export interface WorkerDeps {
  cfg: Config;
  log: Logger;
  alert: Alerter;
  now: () => Date;
  /** Latest commit of the code branch on the remote (cheap: `git ls-remote`). */
  remoteHead: () => Promise<string>;
  readQueue: () => Promise<{base: string; queue: Merge[]}>;
  runJob: (job: Job) => Promise<unknown>;
  /** Runs after every tick (keeping the search index current). Must not throw. */
  afterTick?: () => Promise<unknown>;
}

export type TickResult =
  | {kind: 'idle'}
  | {kind: 'drained'; jobs: number}
  | {kind: 'failed'}
  | {kind: 'blocked'}
  | {kind: 'limited'; until: Date};

/**
 * Single consumer of the merge queue. One tick: if the code branch moved,
 * process queued merges one job at a time until the queue is empty. Nothing
 * runs concurrently, so a later merge can never be synced before an earlier one.
 */
export class Worker {
  private readonly deps: WorkerDeps;
  /** Code head at which the queue was last seen empty; polling is a no-op until it moves. */
  private idleAt: string | null = null;
  /** Failed attempts per job head. */
  private readonly attempts = new Map<string, number>();
  /** Why the queue is stuck, if it is; alerts fire only when this changes. */
  private blockedOn: string | null = null;

  constructor(deps: WorkerDeps) {
    this.deps = deps;
  }

  private async block(key: string, message: string): Promise<TickResult> {
    if (this.blockedOn !== key) {
      this.blockedOn = key;
      await this.deps.alert(`sıra durdu, insan müdahalesi gerekli: ${message}`);
    }
    return {kind: 'blocked'};
  }

  async tick(): Promise<TickResult> {
    const {cfg, log} = this.deps;
    let head: string;
    try {
      head = await this.deps.remoteHead();
    } catch (e) {
      log('warn', 'uzak dal okunamadı', {error: (e as Error).message});
      return {kind: 'failed'};
    }
    if (head === this.idleAt) return {kind: 'idle'};

    let jobs = 0;
    for (;;) {
      let job: Job | null;
      try {
        const {base, queue} = await this.deps.readQueue();
        job = nextJob(base, queue, cfg.batchThreshold);
      } catch (e) {
        if (e instanceof JobFailed && e.fatal) return this.block(`queue:${e.message}`, e.message);
        log('warn', 'sıra okunamadı', {error: (e as Error).message});
        return {kind: 'failed'};
      }
      if (!job) {
        this.idleAt = head;
        this.blockedOn = null;
        return jobs > 0 ? {kind: 'drained', jobs} : {kind: 'idle'};
      }
      if (this.blockedOn === `job:${job.head}`) return {kind: 'blocked'};
      this.blockedOn = null;

      const label = describeMerges(job.merges);
      log('info', 'iş başlıyor', {merges: label, head: job.head.slice(0, 8)});
      try {
        await this.deps.runJob(job);
        this.attempts.delete(job.head);
        jobs++;
        // A dry run commits locally only; reading the queue again would reset that commit away.
        if (cfg.dryRun) return {kind: 'drained', jobs};
      } catch (e) {
        if (e instanceof LimitReached) {
          const until = e.resetAt ?? new Date(this.deps.now().getTime() + cfg.limitBackoffMs);
          log('warn', 'abonelik limiti doldu, bekleniyor', {until: until.toISOString(), message: e.message});
          return {kind: 'limited', until};
        }
        const fatal = e instanceof JobFailed && e.fatal;
        const n = (this.attempts.get(job.head) ?? 0) + 1;
        this.attempts.set(job.head, n);
        log('error', 'iş başarısız', {merges: label, attempt: n, fatal, error: (e as Error).message});
        if (fatal || n >= cfg.maxAttempts) {
          return this.block(`job:${job.head}`, `${label} (${n}. deneme): ${(e as Error).message}`);
        }
        return {kind: 'failed'};
      }
    }
  }

  get area(): string {
    return this.deps.cfg.area;
  }

  get pollIntervalMs(): number {
    return this.deps.cfg.pollIntervalMs;
  }

  /** The after-tick hook (search index); never throws. */
  async afterTick(): Promise<void> {
    await this.deps.afterTick?.();
  }

  async run(signal: AbortSignal, sleep: (ms: number, signal: AbortSignal) => Promise<void>): Promise<void> {
    while (!signal.aborted) {
      const result = await this.tick();
      await this.deps.afterTick?.();
      const wait =
        result.kind === 'limited'
          ? Math.max(result.until.getTime() - this.deps.now().getTime(), 0)
          : this.deps.cfg.pollIntervalMs;
      await sleep(wait, signal);
    }
  }
}

/**
 * Several areas (backend, frontend) in one loop: each tick runs the workers one
 * after another (they share the knowledge base clone), then waits. A usage
 * limit hit by any of them pauses all until it resets: they share the account.
 */
export async function runWorkers(
  workers: Worker[],
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  now: () => Date,
  /** Called after every round with each area's result (the panel's heartbeat). */
  onRound?: (results: {area: string; result: TickResult}[]) => void,
): Promise<void> {
  while (!signal.aborted) {
    let until: Date | null = null;
    const results: {area: string; result: TickResult}[] = [];
    for (const w of workers) {
      if (signal.aborted) return;
      const result = await w.tick();
      await w.afterTick();
      results.push({area: w.area, result});
      if (result.kind === 'limited' && (!until || result.until > until)) until = result.until;
    }
    onRound?.(results);
    const poll = Math.min(...workers.map(w => w.pollIntervalMs));
    await sleep(until ? Math.max(until.getTime() - now().getTime(), 0) : poll, signal);
  }
}
