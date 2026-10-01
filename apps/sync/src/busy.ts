/**
 * A file that says "a job is running" while it is, so that the deploy job
 * (apps/deploy) restarts the worker only between jobs: a restart mid-job
 * throws away a Claude run that can take an hour.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_BUSY_FILE = path.resolve(import.meta.dirname, '../../../work/state/kbsync-busy.json');

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
