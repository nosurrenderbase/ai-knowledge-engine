/**
 * A file that says "a job is running" while it is, so that the deploy job
 * (apps/deploy) restarts the worker only between jobs: a restart mid-job
 * throws away a Claude run that can take an hour.
 */
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
export const DEFAULT_BUSY_FILE = path.join(REPO_ROOT, 'work/state/kbsync-busy.json');
export const DEFAULT_VERSION_FILE = path.join(REPO_ROOT, 'work/state/kbsync-version.json');
export const DEFAULT_HEARTBEAT_FILE = path.join(REPO_ROOT, 'work/state/kbsync-heartbeat.json');

/** After every round: when it ran and how each area's queue looked (idle, drained, blocked, limited, failed). */
export function writeHeartbeat(file: string, results: {area: string; result: {kind: string}}[]): void {
  try {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({at: new Date().toISOString(), areas: results.map(r => ({area: r.area, ...r.result}))}) + '\n');
  } catch {
    // the panel just shows the heartbeat as stale
  }
}

/** Records which commit of this repo the worker process loaded, for the panel's version card. */
export function writeVersionFile(file: string, repo = REPO_ROOT): void {
  let sha = 'unknown';
  try {
    sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
  } catch {
    // not a git checkout (tests, copies): the panel shows "unknown"
  }
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({sha, startedAt: new Date().toISOString(), pid: process.pid}) + '\n');
}

/** Runs fn with the busy file present; it is removed afterwards even if fn throws. */
export async function whileBusy<T>(file: string, info: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({since: new Date().toISOString(), pid: process.pid, ...info}) + '\n');
  try {
    return await fn();
  } finally {
    fs.rmSync(file, {force: true});
  }
}

/** Whether a worker job is running: the file exists and its process is alive (a crash leaves a stale file). */
export function isBusy(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const {pid} = JSON.parse(fs.readFileSync(file, 'utf8')) as {pid?: number};
    if (!pid) return true;
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
