/**
 * Applies the settings changes requested in the panel (packages/settings):
 * for each pending change, in order — open the sealed value, check it against
 * the catalog again, back up the env file, write it, restart what reads the
 * key, check health; on failure put the old file back and restart again.
 * The private key never leaves work/settings on this machine.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {FILES, generateKeys, settingByKey, setEnvValue, unseal, validateChange, type Target} from '@ai-knowledge-engine/settings';
import {restartWorker, TIMEOUTS, waitHealthy, type DeployDeps} from './deploy.ts';

export interface PendingChange {
  id: number;
  requestedBy: string;
  kind: 'set' | 'unset' | 'restart';
  key: string | null;
  target: string | null;
  sealedValue: string | null;
}

export interface SettingsDeps extends Pick<DeployDeps, 'repo' | 'exec' | 'log' | 'alert' | 'sleep' | 'workerBusy' | 'workerLog' | 'workerLabel' | 'timeouts'> {
  /** work/settings: private key here, public key in public/ (mounted into the panel). */
  keysDir: string;
  store: {pending: () => Promise<PendingChange[]>; finish: (id: number, error: string | null) => Promise<void>};
  /** The worker must restart but a job is running: the deploy job restarts it later. */
  deferWorker: () => void;
}

const TARGETS: Target[] = ['mcp', 'panel', 'worker', 'cloudflared'];

/** Creates the key pair on first use. Returns the private key. */
export function ensureKeys(dir: string): string {
  const priv = path.join(dir, 'key.pem');
  const pub = path.join(dir, 'public/key.pub');
  if (!fs.existsSync(priv) || !fs.existsSync(pub)) {
    const k = generateKeys();
    fs.mkdirSync(path.dirname(pub), {recursive: true});
    fs.writeFileSync(priv, k.privateKey, {mode: 0o600});
    fs.writeFileSync(pub, k.publicKey);
  }
  return fs.readFileSync(priv, 'utf8');
}

/**
 * Rewrites the file in place (same inode). Not tmp + rename: the panel
 * container bind-mounts these files one by one, and a bind mount stays on the
 * old inode — after a rename the panel would see a deleted file. A backup is
 * taken before every write, so a torn write can be undone.
 */
function writeInPlace(file: string, text: string): void {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, text, {mode: 0o600});
    return;
  }
  const fd = fs.openSync(file, 'r+');
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, text, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

async function restart(d: SettingsDeps, targets: Target[]): Promise<string | null> {
  const t = {...TIMEOUTS, ...d.timeouts};
  for (const target of targets) {
    if (target === 'worker') {
      if (d.workerBusy()) d.deferWorker();
      else if (!(await restartWorker(d, t))) return 'işçi yeniden başlamadı';
      continue;
    }
    const r = await d.exec('docker', ['compose', 'up', '-d', '--no-build', '--force-recreate', target], {cwd: d.repo, timeoutMs: t.build});
    if (r.code !== 0) return `${target} yeniden başlatılamadı: ${r.out.trim().slice(-300)}`;
    if (!(await waitHealthy(d, t, target))) return `${target} sağlıklı hale gelmedi`;
  }
  return null;
}

/** Applies every pending change; returns how many were processed. */
export async function applySettings(d: SettingsDeps): Promise<number> {
  const pending = await d.store.pending();
  if (!pending.length) return 0;
  const privateKey = ensureKeys(d.keysDir);
  for (const c of pending) {
    const what = c.kind === 'restart' ? `${c.target} yeniden başlatma` : `${c.key} ${c.kind === 'unset' ? 'silme' : 'değişikliği'}`;
    try {
      if (c.kind === 'restart') {
        if (!TARGETS.includes(c.target as Target)) throw new Error(`bilinmeyen servis: ${c.target}`);
        const err = await restart(d, [c.target as Target]);
        if (err) throw new Error(err);
      } else {
        const def = settingByKey(c.key ?? '');
        const value = c.kind === 'unset' ? null : unseal(c.sealedValue ?? '', privateKey);
        const invalid = validateChange(c.key ?? '', value);
        if (!def || invalid) throw new Error(invalid ?? 'bilinmeyen ayar');
        const file = path.join(d.repo, FILES[def.file]);
        const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const backupDir = path.join(d.keysDir, 'backups');
        fs.mkdirSync(backupDir, {recursive: true, mode: 0o700});
        fs.writeFileSync(path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${c.id}-${path.basename(file)}`), before, {mode: 0o600});
        writeInPlace(file, setEnvValue(before, def.key, value));
        const err = await restart(d, def.restart);
        if (err) {
          writeInPlace(file, before);
          const back = await restart(d, def.restart);
          throw new Error(`${err}; eski değere dönüldü${back ? ` (ama: ${back})` : ''}`);
        }
      }
      await d.store.finish(c.id, null);
      d.log('info', 'ayar uygulandı', {id: c.id, change: what, by: c.requestedBy});
      await d.alert(`ayar uygulandı: ${what} (${c.requestedBy})`);
    } catch (e) {
      const msg = (e as Error).message;
      await d.store.finish(c.id, msg);
      d.log('error', 'ayar uygulanamadı', {id: c.id, change: what, by: c.requestedBy, error: msg});
      await d.alert(`ayar uygulanamadı: ${what} (${c.requestedBy}) — ${msg}`);
    }
  }
  return pending.length;
}
