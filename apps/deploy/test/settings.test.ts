import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {beforeEach, describe, it} from 'node:test';
import {seal} from '@ai-knowledge-engine/settings';
import type {Exec} from '../src/deploy.ts';
import {applySettings, ensureKeys, type PendingChange, type SettingsDeps} from '../src/settings.ts';

describe('applySettings', () => {
  let repo: string;
  let keysDir: string;
  let publicKey: string;
  let pending: PendingChange[];
  let finished: [number, string | null][];
  let calls: string[];
  let health: string;
  let busy: boolean;
  let deferred: number;
  let alerts: string[];
  let id = 0;

  const exec: Exec = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'docker' && args[1] === 'ps') return {code: 0, out: args.includes('{{.Health}}') ? health : 'running'};
    return {code: 0, out: ''};
  };
  const deps = (): SettingsDeps => ({
    repo,
    keysDir,
    exec,
    log: () => {},
    alert: async t => void alerts.push(t),
    sleep: async () => {},
    workerBusy: () => busy,
    workerLog: {size: () => 0, since: () => 'kbsync başladı'},
    workerLabel: 'dev.nosurrender.kbsync',
    timeouts: {healthy: 6, workerStart: 6, poll: 3},
    store: {pending: async () => pending.filter(p => !finished.some(f => f[0] === p.id)), finish: async (i, e) => void finished.push([i, e])},
    deferWorker: () => void deferred++,
  });
  const set = (key: string, value: string): PendingChange => ({id: ++id, requestedBy: 'a@b', kind: 'set', key, target: null, sealedValue: seal(value, publicKey)});
  const env = () => fs.readFileSync(path.join(repo, '.env'), 'utf8');

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-repo-'));
    keysDir = path.join(repo, 'work/settings');
    fs.mkdirSync(path.join(repo, 'deploy'), {recursive: true});
    fs.writeFileSync(path.join(repo, '.env'), '# paylaşılan\nMONGO_RO_DB=old\nPOSTGRES_PASSWORD=pg\n', {mode: 0o600});
    fs.writeFileSync(path.join(repo, 'deploy/kbsync.env'), 'GIT_AUTHOR_NAME=x\n');
    ensureKeys(keysDir);
    publicKey = fs.readFileSync(path.join(keysDir, 'public/key.pub'), 'utf8');
    [pending, finished, calls, alerts] = [[], [], [], []];
    [health, busy, deferred] = ['healthy', false, 0];
  });

  it('keeps the private key private and the public key shareable', () => {
    assert.equal(fs.statSync(path.join(keysDir, 'key.pem')).mode & 0o777, 0o600);
    assert.match(publicKey, /BEGIN PUBLIC KEY/);
  });

  it('writes the value, keeps the rest of the file, backs it up and recreates the service', async () => {
    pending = [set('MONGO_RO_DB', 'efsane')];
    const inode = fs.statSync(path.join(repo, '.env')).ino;
    assert.equal(await applySettings(deps()), 1);
    assert.equal(fs.statSync(path.join(repo, '.env')).ino, inode, 'aynı dosyaya yazılır (panelin tek dosya bağlaması kopmaz)');
    assert.equal(env(), '# paylaşılan\nMONGO_RO_DB=efsane\nPOSTGRES_PASSWORD=pg\n');
    assert.equal(fs.statSync(path.join(repo, '.env')).mode & 0o777, 0o600, 'dosya izni korunur');
    assert.ok(calls.includes('docker compose up -d --no-build --force-recreate mcp'));
    assert.deepEqual(finished, [[pending[0].id, null]]);
    assert.equal(fs.readdirSync(path.join(keysDir, 'backups')).length, 1);
    assert.match(alerts[0], /ayar uygulandı: MONGO_RO_DB değişikliği \(a@b\)/);
  });

  it('puts the old file back when the service does not come up', async () => {
    health = 'unhealthy';
    pending = [set('MONGO_RO_DB', 'bozuk')];
    await applySettings(deps());
    assert.match(env(), /MONGO_RO_DB=old/);
    assert.match(finished[0][1]!, /mcp sağlıklı hale gelmedi; eski değere dönüldü/);
    assert.equal(calls.filter(c => c.includes('--force-recreate mcp')).length, 2);
  });

  it('refuses read-only keys even if a request slipped through, and invalid values', async () => {
    pending = [set('POSTGRES_PASSWORD', 'yeni'), set('POLL_INTERVAL_MS', 'sık')];
    await applySettings(deps());
    assert.match(finished[0][1]!, /sunucuda/);
    assert.match(finished[1][1]!, /geçersiz biçim/);
    assert.match(env(), /POSTGRES_PASSWORD=pg/);
    assert.ok(!calls.some(c => c.includes('compose up')));
  });

  it('writes worker settings to kbsync.env and waits for a running job', async () => {
    busy = true;
    pending = [set('POLL_INTERVAL_MS', '60000')];
    await applySettings(deps());
    assert.match(fs.readFileSync(path.join(repo, 'deploy/kbsync.env'), 'utf8'), /POLL_INTERVAL_MS=60000/);
    assert.equal(deferred, 1);
    assert.equal(finished[0][1], null);
  });

  it('removes a key and restarts on request', async () => {
    pending = [
      {id: ++id, requestedBy: 'a@b', kind: 'unset', key: 'MONGO_RO_DB', target: null, sealedValue: null},
      {id: ++id, requestedBy: 'a@b', kind: 'restart', key: null, target: 'panel', sealedValue: null},
      {id: ++id, requestedBy: 'a@b', kind: 'restart', key: null, target: 'postgres', sealedValue: null},
    ];
    await applySettings(deps());
    assert.doesNotMatch(env(), /MONGO_RO_DB/);
    assert.ok(calls.includes('docker compose up -d --no-build --force-recreate panel'));
    assert.deepEqual(finished.map(f => f[1]), [null, null, 'bilinmeyen servis: postgres']);
  });
});
