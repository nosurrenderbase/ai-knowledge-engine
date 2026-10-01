import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {deployOnce, failureSummary, type DeployDeps, type Exec} from '../src/deploy.ts';
import {describePlan, planDeploy} from '../src/plan.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
const gitEnv = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.invalid'};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {cwd, env: gitEnv, encoding: 'utf8'}).trim();

describe('planDeploy', () => {
  it('maps changed paths to what must be restarted', () => {
    assert.equal(describePlan(planDeploy(['README.md', 'apps/mcp/README.md', 'apps/sync/test/x.test.ts', 'docs/EMBEDDING.md'])), 'yeniden başlatma gerekmiyor');
    assert.deepEqual(planDeploy(['apps/sync/src/job.ts']), {npmCi: false, worker: true, services: [], composeAll: false, manual: []});
    assert.deepEqual(planDeploy(['apps/mcp/src/server.ts', 'apps/panel/app/page.tsx']).services, ['mcp', 'panel']);
    assert.deepEqual(planDeploy(['packages/gamedb/src/policy.ts']), {npmCi: false, worker: false, services: ['mcp'], composeAll: false, manual: []});
    const kb = planDeploy(['packages/kb/src/chunks.ts']);
    assert.ok(kb.worker && kb.services.length === 2);
    const deps = planDeploy(['package-lock.json']);
    assert.ok(deps.npmCi && deps.worker);
    assert.ok(planDeploy(['compose.yaml']).composeAll);
    assert.match(planDeploy(['deploy/dev.nosurrender.kbsync.plist']).manual[0], /install-launchd/);
    assert.equal(describePlan(planDeploy(['prompts/backend/UPDATE-PROMPT.md', 'apps/deploy/src/deploy.ts'])), 'yeniden başlatma gerekmiyor');
  });
});

describe('failureSummary', () => {
  it('keeps the failing test and its diff, not the passing noise around it', () => {
    const out = ['  ✔ a geçti', '  ✔ b geçti', '  ✖ health needs no token (2ms)', '  + actual - expected', '  +   version: null', '', '  ✔ c geçti'].join('\n');
    assert.equal(failureSummary(out), '✖ health needs no token (2ms)\n+ actual - expected\n+   version: null');
    assert.equal(failureSummary('npm ERR! kurulum bozuk'), 'npm ERR! kurulum bozuk');
  });
});

describe('deployOnce', () => {
  let root: string;
  let origin: string;
  let dev: string;
  let live: string;
  let calls: string[];
  let alerts: string[];
  let behaviour: {tests: number; health: string; busy: boolean};
  let workerLog: string;
  let builtWith: string[];

  const commit = (files: Record<string, string>, msg: string) => {
    for (const [f, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dev, f)), {recursive: true});
      fs.writeFileSync(path.join(dev, f), c);
    }
    git(dev, 'add', '-A');
    git(dev, 'commit', '-qm', msg);
    git(dev, 'push', '-q', 'origin', 'main');
    return git(dev, 'rev-parse', 'HEAD');
  };

  const exec: Exec = async (cmd, args, opts = {}) => {
    if (opts.env?.GIT_SHA) builtWith.push(opts.env.GIT_SHA);
    calls.push(`${cmd} ${args.join(' ')}`.replace(root, '<root>').replaceAll(root, '<root>'));
    if (cmd === 'git') {
      const r = spawnSync('git', args, {cwd: opts.cwd, env: gitEnv, encoding: 'utf8'});
      return {code: r.status ?? 1, out: `${r.stdout}${r.stderr}`};
    }
    if (cmd === 'npm' && args[0] === 'test') return {code: behaviour.tests, out: behaviour.tests ? 'not ok 3 - bozuk test' : 'ok'};
    if (cmd === 'docker' && args[1] === 'ps') return {code: 0, out: behaviour.health};
    if (cmd === 'launchctl') {
      workerLog += '{"msg":"kbsync başladı"}\n';
      return {code: 0, out: ''};
    }
    return {code: 0, out: ''};
  };

  const deps = (): DeployDeps => ({
    repo: live,
    candidate: path.join(root, 'live/work/deploy/candidate'),
    stateFile: path.join(root, 'live/work/deploy/state.json'),
    branch: 'main',
    workerLabel: 'dev.nosurrender.kbsync',
    exec,
    log: () => {},
    alert: async t => void alerts.push(t),
    sleep: async () => {},
    workerBusy: () => behaviour.busy,
    workerLog: {size: () => workerLog.length, since: o => workerLog.slice(o)},
    timeouts: {healthy: 9, workerStart: 9, poll: 3},
  });

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-')));
    origin = path.join(root, 'origin.git');
    dev = path.join(root, 'dev');
    live = path.join(root, 'live');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'clone', '-q', origin, dev);
    git(dev, 'checkout', '-qb', 'main');
    fs.writeFileSync(path.join(dev, '.gitignore'), 'work/\n.env\n');
    commit({'apps/sync/src/main.ts': 'v1\n'}, 'ilk');
    git(root, 'clone', '-q', origin, live);
    fs.writeFileSync(path.join(live, '.env'), 'X=1\n');
    calls = [];
    alerts = [];
    behaviour = {tests: 0, health: 'healthy', busy: false};
    workerLog = '';
    builtWith = [];
  });
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

  it('does nothing while main has not moved', async () => {
    assert.equal(await deployOnce(deps()), 'idle');
    assert.ok(calls.every(c => c.startsWith('git')));
  });

  it('tests the new commit in a candidate worktree, then fast-forwards and restarts only what changed', async () => {
    const sha = commit({'apps/mcp/src/server.ts': 'x\n', 'apps/sync/src/job.ts': 'y\n'}, 'MCP ve işçi değişti');
    assert.equal(await deployOnce(deps()), 'deployed');
    assert.equal(git(live, 'rev-parse', 'HEAD'), sha);
    assert.ok(fs.existsSync(path.join(root, 'live/work/deploy/candidate/.env')), '.env adaya bağlanır');
    const i = (s: string) => calls.findIndex(c => c.includes(s));
    assert.ok(i('npm test') < i('merge -q --ff-only'), 'canlıya almadan önce test');
    assert.ok(calls.includes('docker compose up -d --build mcp'));
    assert.deepEqual(builtWith, [sha], 'imaja canlıya alınan commit yazılır');
    assert.ok(calls.some(c => c.startsWith('launchctl kickstart -k gui/')));
    assert.match(alerts[0], /^deploy edildi: [0-9a-f]{8} "MCP ve işçi değişti" \(işçi, mcp\)/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'live/work/deploy/state.json'), 'utf8')).deployedSha, sha);
    assert.equal(await deployOnce(deps()), 'idle');
  });

  it('does not deploy a commit whose tests fail, and does not retry it', async () => {
    const before = git(live, 'rev-parse', 'HEAD');
    behaviour.tests = 1;
    commit({'apps/sync/src/job.ts': 'bozuk\n'}, 'bozuk değişiklik');
    assert.equal(await deployOnce(deps()), 'test-failed');
    assert.equal(git(live, 'rev-parse', 'HEAD'), before);
    assert.match(alerts[0], /deploy edilmedi: .* "bozuk değişiklik" — testler başarısız \(çıkış 1\):\nnot ok 3 - bozuk test/);
    calls = [];
    assert.equal(await deployOnce(deps()), 'skipped');
    assert.ok(!calls.some(c => c.includes('npm')), 'aynı commit tekrar denenmez');
    behaviour.tests = 0;
    commit({'apps/sync/src/job.ts': 'düzeldi\n'}, 'düzeltme');
    assert.equal(await deployOnce(deps()), 'deployed');
  });

  it('rolls back when a rebuilt service does not become healthy', async () => {
    const before = git(live, 'rev-parse', 'HEAD');
    behaviour.health = 'unhealthy';
    commit({'apps/panel/app/page.tsx': 'x\n'}, 'panel değişti');
    assert.equal(await deployOnce(deps()), 'rolled-back');
    assert.equal(git(live, 'rev-parse', 'HEAD'), before);
    assert.match(alerts[0], /deploy geri alındı: .* "panel değişti" sağlık kontrolünden geçmedi \(panel sağlıklı hale gelmedi\)/);
    assert.equal(calls.filter(c => c === 'docker compose up -d --build panel').length, 2, 'eski sürümle yeniden ayağa kaldırılır');
  });

  it('waits for a running worker job before restarting the worker', async () => {
    behaviour.busy = true;
    commit({'apps/sync/src/job.ts': 'z\n'}, 'işçi değişti');
    assert.equal(await deployOnce(deps()), 'deployed');
    assert.ok(!calls.some(c => c.startsWith('launchctl')));
    assert.match(alerts[0], /işçi süren iş bitince yeniden başlayacak/);
    behaviour.busy = false;
    calls = [];
    assert.equal(await deployOnce(deps()), 'idle');
    assert.ok(calls.some(c => c.startsWith('launchctl kickstart')), 'sonraki turda yeniden başlatılır');
  });

  it('refuses to touch a live checkout with local edits, and alerts once', async () => {
    fs.writeFileSync(path.join(live, 'apps/sync/src/main.ts'), 'elle düzenlendi\n');
    commit({'apps/sync/src/job.ts': 'w\n'}, 'yeni');
    assert.equal(await deployOnce(deps()), 'skipped');
    assert.equal(await deployOnce(deps()), 'skipped');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /commit edilmemiş değişiklik/);
  });
});
