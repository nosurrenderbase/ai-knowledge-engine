/**
 * One deploy round; launchd (dev.nosurrender.kbdeploy) runs it every 2 minutes.
 *
 *   deploy/run-deploy.sh            # by hand: the same round
 *
 * ALERT_WEBHOOK_URL (deploy/kbsync.env) receives {text} on every deploy, skip,
 * failed test and rollback.
 */
import {spawn} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DEFAULT_BUSY_FILE, isBusy} from '../../sync/src/busy.ts';
import {deployOnce, type Exec} from './deploy.ts';

const REPO = path.resolve(import.meta.dirname, '../../..');
const WORKER_LOG = path.join(REPO, 'work/logs/kbsync.log');

const log = (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) =>
  process.stdout.write(JSON.stringify({time: new Date().toISOString(), level, msg, ...fields}) + '\n');

const exec: Exec = (cmd, args, opts = {}) =>
  new Promise(resolve => {
    const child = spawn(cmd, args, {cwd: opts.cwd ?? REPO, env: {...process.env, ...opts.env}});
    let out = '';
    child.stdout.on('data', b => (out += b));
    child.stderr.on('data', b => (out += b));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : null;
    child.on('error', e => resolve({code: -1, out: `${out}${e.message}`}));
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      resolve({code: code ?? -1, out});
    });
  });

async function alert(text: string): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text: `[kb deploy] ${text}`})});
  } catch (e) {
    log('warn', 'alarm gönderilemedi', {error: (e as Error).message});
  }
}

try {
  const result = await deployOnce({
    repo: REPO,
    candidate: path.join(REPO, 'work/deploy/candidate'),
    stateFile: path.join(REPO, 'work/deploy/state.json'),
    branch: process.env.DEPLOY_BRANCH || 'main',
    workerLabel: 'dev.nosurrender.kbsync',
    exec,
    log,
    alert,
    sleep: ms => delay(ms),
    workerBusy: () => isBusy(process.env.KBSYNC_BUSY_FILE || DEFAULT_BUSY_FILE),
    workerLog: {
      size: () => (fs.existsSync(WORKER_LOG) ? fs.statSync(WORKER_LOG).size : 0),
      since: offset => {
        if (!fs.existsSync(WORKER_LOG)) return '';
        const fd = fs.openSync(WORKER_LOG, 'r');
        try {
          const len = Math.max(0, fs.fstatSync(fd).size - offset);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, offset);
          return buf.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
      },
    },
  });
  if (result !== 'idle' && result !== 'waiting') log('info', 'deploy turu bitti', {result});
} catch (e) {
  log('error', 'deploy turu hata verdi', {error: (e as Error).message});
  await alert(`deploy turu hata verdi: ${(e as Error).message}`);
  process.exitCode = 1;
}
