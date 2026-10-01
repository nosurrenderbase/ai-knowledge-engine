/**
 * One deploy round (launchd runs it every couple of minutes, never two at once):
 *
 *   fetch → main moved? → guards (on main, clean tree, fast-forward)
 *     → candidate worktree at the new commit: npm ci, typecheck, tests
 *     → fast-forward the live checkout → npm ci if dependencies changed
 *     → rebuild the changed containers, restart the worker (only between jobs)
 *     → health checks → on failure reset to the previous commit and restart again.
 *
 * A commit that failed is not retried; the next commit is. The live checkout is
 * also where the services run from, so nothing touches it until the candidate
 * has passed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describePlan, planDeploy, type Plan, type Service} from './plan.ts';

export interface ExecResult {
  code: number;
  out: string;
}
export type Exec = (cmd: string, args: string[], opts?: {cwd?: string; timeoutMs?: number; env?: Record<string, string>}) => Promise<ExecResult>;
type Level = 'info' | 'warn' | 'error';

export interface DeployDeps {
  /** Live checkout: the services run from here. */
  repo: string;
  /** Worktree where a new commit is installed and tested first. */
  candidate: string;
  stateFile: string;
  branch: string;
  workerLabel: string;
  exec: Exec;
  log: (level: Level, msg: string, fields?: Record<string, unknown>) => void;
  alert: (text: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  workerBusy: () => boolean;
  /** Worker log length now, and its text after a given length (for the restart check). */
  workerLog: {size: () => number; since: (offset: number) => string};
  timeouts?: Partial<typeof TIMEOUTS>;
}

const TIMEOUTS = {install: 10 * 60_000, test: 25 * 60_000, build: 15 * 60_000, healthy: 180_000, workerStart: 90_000, poll: 3_000};

interface State {
  deployedSha?: string;
  deployedAt?: string;
  previousSha?: string;
  /** A commit whose tests or health checks failed; not tried again. */
  failedSha?: string;
  /** The worker needs a restart that had to wait for a running job. */
  pendingWorker?: boolean;
  /** Last guard problem alerted (to alert once). */
  alerted?: string;
}

export type DeployResult = 'idle' | 'skipped' | 'test-failed' | 'deployed' | 'rolled-back';

const short = (sha: string) => sha.slice(0, 8);
const tail = (s: string, n = 1500) => (s.length > n ? `…${s.slice(-n)}` : s);

/** The useful part of a failed command: failing test names, assertion diffs, errors; else the end. */
export function failureSummary(out: string, max = 1200): string {
  const lines = out.split('\n');
  const picked: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/✖|^not ok|error TS\d+|AssertionError|Error:/.test(lines[i])) {
      for (const l of lines.slice(i, i + 4)) if (l.trim() && !picked.includes(l)) picked.push(l);
    }
  }
  const text = (picked.length ? picked.map(l => l.trim()).join('\n') : out).trim();
  return text.length > max ? (picked.length ? `${text.slice(0, max)}…` : tail(text, max)) : text;
}

export async function deployOnce(d: DeployDeps): Promise<DeployResult> {
  const t = {...TIMEOUTS, ...d.timeouts};
  const state: State = fs.existsSync(d.stateFile) ? JSON.parse(fs.readFileSync(d.stateFile, 'utf8')) : {};
  const save = () => {
    fs.mkdirSync(path.dirname(d.stateFile), {recursive: true});
    fs.writeFileSync(d.stateFile, JSON.stringify(state, null, 1) + '\n');
  };
  const git = (...args: string[]) => d.exec('git', ['-C', d.repo, ...args]);
  const must = async (what: string, p: Promise<ExecResult>) => {
    const r = await p;
    if (r.code !== 0) throw new Error(`${what} başarısız (çıkış ${r.code}):\n${failureSummary(r.out)}`);
    return r.out.trim();
  };

  // A worker restart left over from an earlier round waits for the running job to end.
  if (state.pendingWorker && !d.workerBusy()) {
    if (await restartWorker(d, t)) {
      state.pendingWorker = false;
      save();
      d.log('info', 'bekleyen işçi yeniden başlatması yapıldı');
    }
  }

  await must('git fetch', git('fetch', '-q', 'origin', d.branch));
  const local = await must('rev-parse', git('rev-parse', 'HEAD'));
  const remote = await must('rev-parse', git('rev-parse', `origin/${d.branch}`));
  if (local === remote) return 'idle';
  if (state.failedSha === remote) return 'skipped';

  const guard = async (key: string, message: string): Promise<DeployResult> => {
    if (state.alerted !== `${key}:${remote}`) {
      state.alerted = `${key}:${remote}`;
      save();
      d.log('warn', 'deploy atlandı', {reason: message, remote: short(remote)});
      await d.alert(`deploy atlandı (${short(remote)}): ${message}`);
    }
    return 'skipped';
  };
  if ((await must('branch', git('rev-parse', '--abbrev-ref', 'HEAD'))) !== d.branch) return guard('branch', `canlı klon ${d.branch} dalında değil`);
  if (await must('status', git('status', '--porcelain'))) return guard('dirty', 'canlı klonda commit edilmemiş değişiklik var; sunucuda elle düzenleme yapılmamalı');
  if ((await git('merge-base', '--is-ancestor', 'HEAD', `origin/${d.branch}`)).code !== 0) return guard('diverged', `origin/${d.branch} ileri sarılamıyor (geçmiş yeniden yazılmış ya da sunucuda yerel commit var)`);

  const subject = await must('log', git('log', '-1', '--format=%s', remote));
  d.log('info', 'yeni commit, aday klonda deneniyor', {from: short(local), to: short(remote), subject});

  // 1. Candidate: install and test the new commit away from the running services.
  try {
    await prepareCandidate(d, remote, must);
    await must('npm ci (aday)', d.exec('npm', ['ci', '--no-audit', '--no-fund'], {cwd: d.candidate, timeoutMs: t.install}));
    await must('typecheck', d.exec('npm', ['run', 'typecheck'], {cwd: d.candidate, timeoutMs: t.test}));
    await must('testler', d.exec('npm', ['test'], {cwd: d.candidate, timeoutMs: t.test}));
  } catch (e) {
    state.failedSha = remote;
    save();
    d.log('error', 'aday başarısız, deploy edilmedi', {to: short(remote), error: (e as Error).message});
    await d.alert(`deploy edilmedi: ${short(remote)} "${subject}" — ${(e as Error).message}`);
    return 'test-failed';
  }

  // 2. Live: fast-forward, then restart what the change needs.
  const changed = (await must('diff', git('diff', '--name-only', local, remote))).split('\n').filter(Boolean);
  const plan = planDeploy(changed);
  d.log('info', 'canlıya alınıyor', {to: short(remote), plan: describePlan(plan)});
  await must('merge', git('merge', '-q', '--ff-only', remote));
  const applied = await apply(d, t, plan, state, remote);

  if (applied.ok) {
    Object.assign(state, {deployedSha: remote, deployedAt: new Date().toISOString(), previousSha: local, failedSha: undefined, alerted: undefined});
    save();
    const extra = [state.pendingWorker && 'işçi süren iş bitince yeniden başlayacak', ...plan.manual].filter(Boolean).join('; ');
    d.log('info', 'deploy tamam', {sha: short(remote), plan: describePlan(plan)});
    await d.alert(`deploy edildi: ${short(remote)} "${subject}" (${describePlan(plan)})${extra ? ` — ${extra}` : ''}`);
    return 'deployed';
  }

  // 3. Roll back to the previous commit and bring the same parts up again.
  d.log('error', 'sağlık kontrolü başarısız, geri alınıyor', {to: short(remote), error: applied.error});
  await must('reset', git('reset', '-q', '--hard', local));
  const back = await apply(d, t, plan, state, local);
  state.failedSha = remote;
  save();
  await d.alert(
    `deploy geri alındı: ${short(remote)} "${subject}" sağlık kontrolünden geçmedi (${applied.error}); ${short(local)} çalışıyor${back.ok ? '' : `, AMA geri dönüş de sorunlu: ${back.error}`}`,
  );
  return 'rolled-back';
}

async function prepareCandidate(d: DeployDeps, sha: string, must: (what: string, p: Promise<ExecResult>) => Promise<string>): Promise<void> {
  if (!fs.existsSync(path.join(d.candidate, '.git'))) {
    await d.exec('git', ['-C', d.repo, 'worktree', 'prune']);
    fs.mkdirSync(path.dirname(d.candidate), {recursive: true});
    await must('worktree add', d.exec('git', ['-C', d.repo, 'worktree', 'add', '-q', '--detach', d.candidate, sha]));
  } else {
    await must('checkout (aday)', d.exec('git', ['-C', d.candidate, 'checkout', '-q', '--force', '--detach', sha]));
    await must('clean (aday)', d.exec('git', ['-C', d.candidate, 'clean', '-fdq']));
  }
  // Tests that use Redis and Postgres read the shared settings.
  const env = path.join(d.candidate, '.env');
  if (!fs.existsSync(env) && fs.existsSync(path.join(d.repo, '.env'))) fs.symlinkSync(path.join(d.repo, '.env'), env);
}

/** sha: the commit now checked out, baked into rebuilt images (their version on the panel). */
async function apply(d: DeployDeps, t: typeof TIMEOUTS, plan: Plan, state: State, sha: string): Promise<{ok: true} | {ok: false; error: string}> {
  try {
    if (plan.npmCi) {
      const r = await d.exec('npm', ['ci', '--no-audit', '--no-fund'], {cwd: d.repo, timeoutMs: t.install});
      if (r.code !== 0) return {ok: false, error: `npm ci: ${tail(r.out, 400)}`};
    }
    const services: Service[] | 'all' = plan.composeAll ? 'all' : plan.services;
    if (services === 'all' || services.length) {
      const r = await d.exec('docker', ['compose', 'up', '-d', '--build', ...(services === 'all' ? [] : services)], {cwd: d.repo, timeoutMs: t.build, env: {GIT_SHA: sha}});
      if (r.code !== 0) return {ok: false, error: `docker compose: ${tail(r.out, 400)}`};
      for (const s of services === 'all' ? (['mcp', 'panel'] as Service[]) : services) {
        if (!(await waitHealthy(d, t, s))) return {ok: false, error: `${s} sağlıklı hale gelmedi`};
      }
    }
    if (plan.worker) {
      if (d.workerBusy()) state.pendingWorker = true;
      else if (!(await restartWorker(d, t))) return {ok: false, error: 'işçi yeniden başlamadı'};
    }
    return {ok: true};
  } catch (e) {
    return {ok: false, error: (e as Error).message};
  }
}

async function waitHealthy(d: DeployDeps, t: typeof TIMEOUTS, service: Service): Promise<boolean> {
  for (let waited = 0; waited <= t.healthy; waited += t.poll) {
    const r = await d.exec('docker', ['compose', 'ps', '--format', '{{.Health}}', service], {cwd: d.repo});
    if (r.code === 0 && r.out.trim() === 'healthy') return true;
    await d.sleep(t.poll);
  }
  return false;
}

async function restartWorker(d: DeployDeps, t: typeof TIMEOUTS): Promise<boolean> {
  const offset = d.workerLog.size();
  const uid = process.getuid?.() ?? 501;
  const r = await d.exec('launchctl', ['kickstart', '-k', `gui/${uid}/${d.workerLabel}`]);
  if (r.code !== 0) return false;
  for (let waited = 0; waited <= t.workerStart; waited += t.poll) {
    if (d.workerLog.since(offset).includes('kbsync başladı')) return true;
    await d.sleep(t.poll);
  }
  return false;
}
