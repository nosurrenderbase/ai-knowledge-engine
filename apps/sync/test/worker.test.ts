import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {loadConfig} from '../src/config.ts';
import type {Merge} from '../src/git.ts';
import {JobFailed, LimitReached} from '../src/job.ts';
import type {Job} from '../src/queue.ts';
import {Worker, type WorkerDeps} from '../src/worker.ts';

const m = (n: number): Merge => ({sha: `m${n}`, subject: `Merge pull request #${n}`, pr: n});

/**
 * An in-memory code branch: `merges` is main's first-parent history after the
 * initial commit, `watermark` the index of the last synced merge (-1: none).
 */
class FakeRepo {
  merges: Merge[] = [];
  watermark = -1;
  push(...ns: number[]) {
    this.merges.push(...ns.map(m));
  }
  get head() {
    return this.merges.at(-1)?.sha ?? 'initial';
  }
  get base() {
    return this.watermark < 0 ? 'initial' : this.merges[this.watermark].sha;
  }
}

function setup(opts: {runJob?: (job: Job, repo: FakeRepo) => Promise<void>; env?: Record<string, string>} = {}) {
  const repo = new FakeRepo();
  const ran: string[][] = [];
  const alerts: string[] = [];
  let reads = 0;
  const now = new Date(2026, 8, 29, 12, 0);
  const deps: WorkerDeps = {
    cfg: loadConfig({KB_REPO: '/k', CODE_REPO: '/c', LIMIT_BACKOFF_MS: '600000', ...opts.env}),
    log: () => {},
    alert: async msg => void alerts.push(msg),
    now: () => now,
    remoteHead: async () => repo.head,
    readQueue: async () => {
      reads++;
      return {base: repo.base, queue: repo.merges.slice(repo.watermark + 1)};
    },
    runJob: async job => {
      ran.push(job.merges.map(x => x.sha));
      if (opts.runJob) await opts.runJob(job, repo);
      repo.watermark = repo.merges.findIndex(x => x.sha === job.head);
    },
  };
  return {repo, ran, alerts, deps, worker: new Worker(deps), reads: () => reads, now};
}

describe('Worker.tick', () => {
  it('does nothing while the remote head has not moved since the queue was empty', async () => {
    const t = setup();
    assert.deepEqual(await t.worker.tick(), {kind: 'idle'});
    assert.deepEqual(await t.worker.tick(), {kind: 'idle'});
    assert.equal(t.reads(), 1, 'ikinci turda sıra okunmadı (yalnız ls-remote)');
  });

  it('processes merges one at a time, oldest first, until the queue is empty', async () => {
    const t = setup();
    t.repo.push(1, 2, 3);
    assert.deepEqual(await t.worker.tick(), {kind: 'drained', jobs: 3});
    assert.deepEqual(t.ran, [['m1'], ['m2'], ['m3']]);
  });

  it('picks up merges that land while a job is running, after it, in order', async () => {
    const t = setup({
      runJob: async (job, repo) => {
        if (job.head === 'm1') repo.push(2); // the small fix lands during the big feature's job
      },
    });
    t.repo.push(1);
    await t.worker.tick();
    assert.deepEqual(t.ran, [['m1'], ['m2']]);
  });

  it('stops after one job in dry-run mode so the local commit survives', async () => {
    const t = setup({env: {DRY_RUN: '1'}});
    t.repo.push(1, 2);
    assert.deepEqual(await t.worker.tick(), {kind: 'drained', jobs: 1});
    assert.deepEqual(t.ran, [['m1']]);
  });

  it('batches a backlog larger than the threshold into one job', async () => {
    const t = setup();
    t.repo.push(1, 2, 3, 4);
    await t.worker.tick();
    assert.deepEqual(t.ran, [['m1', 'm2', 'm3', 'm4']]);
  });

  it('retries a failed job on the next tick without skipping it', async () => {
    let fail = true;
    const t = setup({
      runJob: async () => {
        if (fail) throw new Error('geçici');
      },
    });
    t.repo.push(1, 2);
    assert.deepEqual(await t.worker.tick(), {kind: 'failed'});
    fail = false;
    await t.worker.tick();
    assert.deepEqual(t.ran, [['m1'], ['m1'], ['m2']]);
  });

  it('blocks the queue after maxAttempts failures and alerts once', async () => {
    const t = setup({
      runJob: async () => {
        throw new Error('hep bozuk');
      },
    });
    t.repo.push(1, 2);
    assert.equal((await t.worker.tick()).kind, 'failed');
    assert.equal((await t.worker.tick()).kind, 'failed');
    assert.equal((await t.worker.tick()).kind, 'blocked');
    assert.equal((await t.worker.tick()).kind, 'blocked');
    assert.equal(t.ran.length, 3, 'durduktan sonra iş denenmez');
    assert.equal(t.alerts.length, 1);
    assert.match(t.alerts[0], /#1 \(3\. deneme\): hep bozuk/);
  });

  it('blocks at once on a fatal failure', async () => {
    const t = setup({
      runJob: async () => {
        throw new JobFailed('gizli bilgi', true);
      },
    });
    t.repo.push(1);
    assert.equal((await t.worker.tick()).kind, 'blocked');
    assert.equal(t.alerts.length, 1);
  });

  it('unblocks when a human moves the watermark past the stuck merge', async () => {
    const t = setup({
      runJob: async job => {
        if (job.head === 'm1') throw new JobFailed('bozuk', true);
      },
    });
    t.repo.push(1, 2);
    assert.equal((await t.worker.tick()).kind, 'blocked');
    t.repo.watermark = 0; // someone synced #1 by hand
    assert.deepEqual(await t.worker.tick(), {kind: 'drained', jobs: 1});
    assert.deepEqual(t.ran.at(-1), ['m2']);
  });

  it('waits for the usage limit reset without counting an attempt', async () => {
    let limited = 0;
    const resetAt = new Date(2026, 8, 29, 15, 1);
    const t = setup({
      runJob: async () => {
        if (limited++ < 5) throw new LimitReached('limit', resetAt);
      },
    });
    t.repo.push(1);
    for (let i = 0; i < 5; i++) assert.deepEqual(await t.worker.tick(), {kind: 'limited', until: resetAt});
    assert.deepEqual(await t.worker.tick(), {kind: 'drained', jobs: 1});
    assert.equal(t.alerts.length, 0);
  });

  it('falls back to the configured backoff when the reset time is unknown', async () => {
    const t = setup({
      runJob: async () => {
        throw new LimitReached('limit', null);
      },
    });
    t.repo.push(1);
    assert.deepEqual(await t.worker.tick(), {kind: 'limited', until: new Date(t.now.getTime() + 600_000)});
  });

  it('blocks when the watermark is not on the branch', async () => {
    const t = setup();
    t.repo.push(1);
    const worker = new Worker({
      ...t.deps,
      readQueue: async () => {
        throw new JobFailed('force-push?', true);
      },
    });
    assert.equal((await worker.tick()).kind, 'blocked');
  });

  it('treats network errors as transient', async () => {
    const t = setup();
    const worker = new Worker({
      ...t.deps,
      remoteHead: async () => {
        throw new Error('ağ yok');
      },
    });
    assert.deepEqual(await worker.tick(), {kind: 'failed'});
  });
});

describe('Worker.run', () => {
  it('sleeps the poll interval between ticks and until the reset after a limit', async () => {
    const resetAt = new Date(2026, 8, 29, 12, 30);
    let calls = 0;
    const t = setup({
      runJob: async () => {
        if (calls++ === 0) throw new LimitReached('limit', resetAt);
      },
      env: {POLL_INTERVAL_MS: '120000'},
    });
    t.repo.push(1);
    const controller = new AbortController();
    const sleeps: number[] = [];
    await t.worker.run(controller.signal, async ms => {
      sleeps.push(ms);
      if (sleeps.length === 3) controller.abort();
    });
    assert.deepEqual(sleeps, [30 * 60_000, 120_000, 120_000]);
    assert.deepEqual(t.ran, [['m1'], ['m1']]);
  });

  it('runs the after-tick hook (search index) once per loop, after the tick', async () => {
    const t = setup();
    const order: string[] = [];
    const worker = new Worker({
      ...t.deps,
      remoteHead: async () => (order.push('tick'), t.repo.head),
      afterTick: async () => order.push('index'),
    });
    const controller = new AbortController();
    let loops = 0;
    await worker.run(controller.signal, async () => {
      if (++loops === 2) controller.abort();
    });
    assert.deepEqual(order, ['tick', 'index', 'tick', 'index']);
  });
});
