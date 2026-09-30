/**
 * End to end: real git repos (bare "remotes", seed working copies, the
 * worker's clones), the real validator and chunk builder, a fake card
 * generator and a fake `claude` binary driven by a script.
 */
import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {defaultClaude, JobFailed, LimitReached, readQueue, runJob, type JobDeps} from '../src/job.ts';
import {nextJob} from '../src/queue.ts';
import {Worker} from '../src/worker.ts';
import {Git} from '../src/git.ts';
import {claudeCalls, cleanup, git, mergePr, read, scriptClaude, setupFixture, write, type Fixture} from './helpers/repos.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const FLOW = 'backend/flows/pvp/gunluk-hak.md';
const CARD = 'backend/usecases/pvp-match/start-pvp.usecase.md';
const NOW = new Date(2026, 8, 29, 12, 0);

function deps(fx: Fixture): JobDeps {
  return {cfg: fx.cfg, log: () => {}, now: () => NOW, claude: defaultClaude(fx.cfg)};
}

/** Merges a PR in the code seed and pushes it to the code remote. */
function land(fx: Fixture, pr: number, files: Record<string, string | null>): string {
  const sha = mergePr(fx.codeSeed, pr, files);
  git(fx.codeSeed, 'push', '--quiet', 'origin', 'main');
  return sha;
}

async function syncNext(fx: Fixture) {
  const {base, queue} = await readQueue(fx.cfg);
  const job = nextJob(base, queue, fx.cfg.batchThreshold);
  assert.ok(job, 'sırada iş olmalı');
  return runJob(job, deps(fx));
}

const remote = (fx: Fixture, ...args: string[]) => git(fx.kbBare, ...args);
const remoteFile = (fx: Fixture, file: string) => remote(fx, 'show', `main:${file}`);
const short = (fx: Fixture, sha: string) => git(fx.codeSeed, 'rev-parse', '--short=8', sha);

const limitTo5 = {'src/modules/pvp-match/domain/constants/pvp.constant.ts': 'export const PVP_DAILY_LIMIT = 5;\n'};
const flowTo5 = {path: FLOW, replace: ['`PVP_DAILY_LIMIT` = 3 maç', '`PVP_DAILY_LIMIT` = 5 maç']};

describe('runJob (uçtan uca)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = setupFixture();
  });
  afterEach(() => cleanup(fx));

  it('syncs one merge: Claude edits, validation passes, one commit is pushed', async () => {
    const head = land(fx, 10, limitTo5);
    scriptClaude(fx, [
      {
        edits: [flowTo5],
        report: {
          updated: [{path: 'flows/pvp/gunluk-hak.md', sections: ['Kurallar ve baremler'], reason: 'sabit değişti'}],
          value_changes: [{doc: 'flows/pvp/gunluk-hak.md', rule: 'PvP günlük hak', old: '3', new: '5', source: 'PVP_DAILY_LIMIT (pvp.constant.ts)'}],
        },
      },
    ]);

    const result = await syncNext(fx);

    assert.match(remoteFile(fx, FLOW), /`PVP_DAILY_LIMIT` = 5 maç/);
    assert.equal(remoteFile(fx, 'backend/.source-commit'), short(fx, head));
    assert.match(remoteFile(fx, 'backend/README.md'), new RegExp(`Kod commit: \`${short(fx, head)}\` \\(29\\.09\\.2026, main\\)`));

    const message = remote(fx, 'log', '-1', '--format=%B');
    assert.match(message, /^backend: #10 senkronu \(kod [0-9a-f]{8}\.\.[0-9a-f]{8}\)/);
    assert.match(message, /- PvP günlük hak: 3 → 5/);
    assert.doesNotMatch(message, /Co-Authored|Claude|Generated/i, 'commit imzasız olmalı');
    assert.equal(remote(fx, 'log', '-1', '--format=%an <%ae>'), 'kbsync <kbsync@example.invalid>');
    assert.equal(result.costUsd, 0.5);

    // The card quotes the constant's value, so it was regenerated with the new value; its paragraph is kept.
    const files = remote(fx, 'show', '--name-only', '--format=', 'main').split('\n').sort();
    assert.deepEqual(files, ['backend/.source-commit', 'backend/README.md', FLOW, CARD]);
    assert.match(remoteFile(fx, CARD), /\| `PVP_DAILY_LIMIT` \| `5` \|/);
    assert.match(remoteFile(fx, CARD), /PvP maçını başlatır; günlük hakkı kontrol eder\./);

    const [call] = claudeCalls(fx);
    assert.equal(call.cwd, fx.kbClone);
    assert.equal(call.args[call.args.indexOf('--add-dir') + 1], fx.codeClone);
    assert.match(call.stdin, /^BASE: [0-9a-f]{8} {2}HEAD: [0-9a-f]{8}/);
    assert.match(call.stdin, /flows\/pvp\/gunluk-hak\.md {2}← sources: M src\/modules\/pvp-match\/domain\/constants\/pvp\.constant\.ts/);
    assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1], /^Sen Efsane Başkan/);
  });

  it('drops cards whose only change is the code_commit stamp', async () => {
    const usecase = 'src/modules/pvp-match/usecases/start-pvp.usecase.ts';
    land(fx, 26, {[usecase]: read(fx.codeSeed, usecase).replace('return PVP_DAILY_LIMIT;', '// yalnız yorum\n    return PVP_DAILY_LIMIT;')});
    scriptClaude(fx, [{}]);
    await syncNext(fx);
    const call = claudeCalls(fx)[0];
    assert.match(call.stdin, /Kartları yeniden üretilen modüller: pvp-match/);
    const files = remote(fx, 'show', '--name-only', '--format=', 'main').split('\n').sort();
    assert.deepEqual(files, ['backend/.source-commit', 'backend/README.md']);
  });

  it('checks the code worktree out at the job head', async () => {
    const head = land(fx, 10, limitTo5);
    scriptClaude(fx, [{edits: [flowTo5]}]);
    await syncNext(fx);
    assert.equal(git(fx.codeClone, 'rev-parse', 'HEAD'), head);
  });

  it('advances only the watermark, without Claude, when nothing relevant changed', async () => {
    const head = land(fx, 11, {
      'src/modules/pvp-match/usecases/start-pvp.usecase.spec.ts': 'test\n',
      'docs/NOTLAR.md': 'not\n',
    });
    scriptClaude(fx, []);
    const result = await syncNext(fx);
    assert.equal(result.report, null);
    assert.equal(claudeCalls(fx).length, 0);
    assert.equal(remoteFile(fx, 'backend/.source-commit'), short(fx, head));
    assert.match(remote(fx, 'log', '-1', '--format=%B'), /Belgelenen davranışı etkileyen kod değişikliği yok/);
  });

  it('feeds validation errors back into the same session and commits once they are fixed', async () => {
    land(fx, 12, limitTo5);
    scriptClaude(fx, [
      {edits: [flowTo5, {path: FLOW, replace: ['Bkz. [modül]', 'Bkz. [yok](../../yok.md) [modül]']}]},
      {edits: [{path: FLOW, replace: ['[yok](../../yok.md) ', '']}]},
    ]);
    await syncNext(fx);

    const calls = claudeCalls(fx);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args[calls[1].args.indexOf('--resume') + 1], 'session-0');
    assert.match(calls[1].stdin, /flows\/pvp\/gunluk-hak\.md: kırık link \.\.\/\.\.\/yok\.md/);
    assert.doesNotMatch(remoteFile(fx, FLOW), /yok\.md/);
  });

  it('gives up after the configured rounds without pushing anything', async () => {
    land(fx, 13, limitTo5);
    const before = remote(fx, 'rev-parse', 'main');
    const bad = {path: FLOW, replace: ['`PVP_DAILY_LIMIT` = 3 maç', '`PVP_WEEKLY_LIMIT` = 5 maç']};
    scriptClaude(fx, [{edits: [bad]}, {}, {}]);
    await assert.rejects(syncNext(fx), (e: unknown) => e instanceof JobFailed && !e.fatal && /`PVP_WEEKLY_LIMIT` kodda bulunamadı/.test(e.message));
    assert.equal(claudeCalls(fx).length, 3, 'ilk çağrı + 2 düzeltme turu');
    assert.equal(remote(fx, 'rev-parse', 'main'), before);
  });

  it('refuses to touch the generated block of a card', async () => {
    land(fx, 14, limitTo5);
    scriptClaude(fx, [
      {edits: [flowTo5, {path: CARD, replace: ['# StartPvpUseCase', '# Elle düzeltildi']}]},
      {edits: [{path: CARD, replace: ['# Elle düzeltildi', '# StartPvpUseCase']}]},
    ]);
    await syncNext(fx);
    assert.match(claudeCalls(fx)[1].stdin, /gen:start.*arası değiştirilmiş/);
  });

  it('stops without retry when a secret shows up', async () => {
    land(fx, 15, limitTo5);
    const before = remote(fx, 'rev-parse', 'main');
    scriptClaude(fx, [{edits: [flowTo5, {path: FLOW, replace: ['## Kurallar', 'Bağlantı: mongodb://kullanici:parola@db.example.net/oyun\n\n## Kurallar']}]}]);
    await assert.rejects(syncNext(fx), (e: unknown) => e instanceof JobFailed && e.fatal && /gizli bilgi şüphesi \(bağlantı adresi/.test(e.message));
    assert.equal(claudeCalls(fx).length, 1);
    assert.equal(remote(fx, 'rev-parse', 'main'), before);
  });

  it('stops when Claude edits a file it must not touch', async () => {
    land(fx, 16, limitTo5);
    scriptClaude(fx, [{edits: [flowTo5, {path: 'backend/README.md', replace: ['## Durum', '## Durum (değişti)']}]}]);
    await assert.rejects(syncNext(fx), (e: unknown) => e instanceof JobFailed && e.fatal && /işçinin yönettiği doküman değişti/.test(e.message));
  });

  it('stops when the code worktree was modified', async () => {
    land(fx, 25, limitTo5);
    // The fake edits relative to its cwd (the KB clone); the code clone sits next to it.
    scriptClaude(fx, [{edits: [flowTo5, {path: '../code/README.md', content: 'kurcalandı\n'}]}]);
    await assert.rejects(syncNext(fx), (e: unknown) => e instanceof JobFailed && e.fatal && /kod reposunda dosya değişti \(salt okunur olmalı\): README\.md/.test(e.message));
  });

  it('reports a usage limit without moving the watermark', async () => {
    land(fx, 17, limitTo5);
    scriptClaude(fx, [{result: 'limit', text: "You've hit your session limit · resets 3pm"}]);
    await assert.rejects(syncNext(fx), (e: unknown) => e instanceof LimitReached && e.resetAt?.getHours() === 15);
    assert.equal(remoteFile(fx, 'backend/.source-commit'), read(fx.kbSeed, 'backend/.source-commit').trim());
  });

  it('fails the attempt when Claude fails', async () => {
    land(fx, 18, limitTo5);
    scriptClaude(fx, [{result: 'max_turns'}]);
    await assert.rejects(syncNext(fx), (e: unknown) => e instanceof JobFailed && !e.fatal && /error_max_turns/.test(e.message));
  });

  it('generates a card for a new use case and requires its paragraph', async () => {
    land(fx, 19, {'src/modules/pvp-match/usecases/end-pvp.usecase.ts': 'export class EndPvpUseCase {}\n'});
    const newCard = 'backend/usecases/pvp-match/end-pvp.usecase.md';
    scriptClaude(fx, [
      {},
      {edits: [{path: newCard, replace: ['_TODO: 2-3 cümle, iş diliyle (AI doldurur)._', 'PvP maçını bitirir.']}]},
    ]);
    await syncNext(fx);
    const calls = claudeCalls(fx);
    assert.match(calls[0].stdin, /usecases\/pvp-match\/end-pvp\.usecase\.md {2}← YENİ kart/);
    assert.match(calls[1].stdin, /end-pvp\.usecase\.md: _TODO: kalmış/);
    assert.match(remoteFile(fx, newCard), /PvP maçını bitirir\./);
  });

  it('asks for new endpoints to be documented', async () => {
    const resolver = 'src/modules/pvp-match/presentation/pvp.resolver.ts';
    land(fx, 20, {[resolver]: read(fx.codeSeed, resolver).replace('}\n}', '}\n\n  @Query(() => Int)\n  pvpAllowance() {\n    return 3;\n  }\n}')});
    const moduleDoc = 'backend/modules/pvp-match.md';
    scriptClaude(fx, [{}, {edits: [{path: moduleDoc, replace: ['Uç: `startPvp`.', 'Uçlar: `startPvp`, `pvpAllowance`.']}]}]);
    await syncNext(fx);
    assert.match(claudeCalls(fx)[1].stdin, /GraphQL işlemi `pvpAllowance`/);
  });

  it('splits a large impact list into several calls, genel last, and merges their reports', async () => {
    fx.cfg.groupMaxDocs = 1;
    land(fx, 24, {
      ...limitTo5,
      'src/common/locks/lock.ts': 'export const LOCK = 2;\n',
      'src/modules/pvp-match/pvp-match.module.ts': 'export class PvpMatchModule { v = 2; }\n',
    });
    const report = (rule: string) => ({value_changes: [{doc: 'x', rule, old: '1', new: '2', source: 's'}]});
    scriptClaude(fx, [{edits: [flowTo5], report: report('bir')}, {report: report('iki')}, {report: report('üç')}]);
    await syncNext(fx);

    const calls = claudeCalls(fx);
    assert.equal(calls.length, 3);
    assert.match(calls[0].stdin, /1\/3\. parçası/);
    assert.match(calls[0].stdin, /^flows\/pvp\/gunluk-hak\.md {2}←/m);
    assert.doesNotMatch(calls[0].stdin, /^modules\/pvp-match\.md {2}←/m);
    assert.match(calls[2].stdin, /^genel\/altyapi\.md {2}←/m, 'genel en sonda');
    const message = remote(fx, 'log', '-1', '--format=%B');
    for (const rule of ['bir', 'iki', 'üç']) assert.match(message, new RegExp(`- ${rule}: 1 → 2`));
  });

  it('commits locally but does not push in dry-run mode', async () => {
    fx.cfg.dryRun = true;
    land(fx, 21, limitTo5);
    const before = remote(fx, 'rev-parse', 'main');
    scriptClaude(fx, [{edits: [flowTo5]}]);
    await syncNext(fx);
    assert.equal(remote(fx, 'rev-parse', 'main'), before);
    assert.match(git(fx.kbClone, 'log', '-1', '--format=%s'), /#21 senkronu/);
  });

  it('fails the attempt when the push is rejected, and succeeds on the retry', async () => {
    land(fx, 22, limitTo5);
    scriptClaude(fx, [{edits: [flowTo5]}, {edits: [flowTo5]}]);
    const {base, queue} = await readQueue(fx.cfg);
    // Someone pushes to the knowledge base while the job runs.
    git(fx.kbSeed, 'commit', '--quiet', '--allow-empty', '-m', 'elle düzeltme');
    git(fx.kbSeed, 'push', '--quiet', 'origin', 'main');
    await assert.rejects(runJob(nextJob(base, queue, 3)!, deps(fx)), /push/);
    await syncNext(fx);
    assert.equal(remote(fx, 'log', '-2', '--format=%s').split('\n')[1], 'elle düzeltme');
  });

  it('blocks on a watermark that is not on the code branch', async () => {
    land(fx, 23, limitTo5);
    // A watermark that is a real commit, but not on main (e.g. main was force-pushed).
    git(fx.codeSeed, 'checkout', '--quiet', '-b', 'yan-dal', 'HEAD~1');
    git(fx.codeSeed, 'commit', '--quiet', '--allow-empty', '-m', 'yan');
    git(fx.codeSeed, 'push', '--quiet', 'origin', 'yan-dal');
    write(fx.kbSeed, 'backend/.source-commit', `${git(fx.codeSeed, 'rev-parse', '--short=8', 'HEAD')}\n`);
    git(fx.kbSeed, 'commit', '--quiet', '-am', 'bozuk watermark');
    git(fx.kbSeed, 'push', '--quiet', 'origin', 'main');
    await assert.rejects(readQueue(fx.cfg), (e: unknown) => e instanceof JobFailed && e.fatal && /geçmişinde değil/.test(e.message));
  });

  it('blocks on a watermark the code repo does not know', async () => {
    write(fx.kbSeed, 'backend/.source-commit', 'ffffffff\n');
    git(fx.kbSeed, 'commit', '--quiet', '-am', 'bilinmeyen watermark');
    git(fx.kbSeed, 'push', '--quiet', 'origin', 'main');
    await assert.rejects(readQueue(fx.cfg), (e: unknown) => e instanceof JobFailed && e.fatal && /bulunamadı/.test(e.message));
  });
});

describe('Worker (uçtan uca)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = setupFixture();
  });
  afterEach(() => cleanup(fx));

  function worker(fx: Fixture) {
    const d = deps(fx);
    const code = new Git(fx.cfg.codeRepo);
    return new Worker({
      cfg: fx.cfg,
      log: () => {},
      alert: async () => {},
      now: () => NOW,
      remoteHead: () => code.remoteHead('origin', 'main'),
      readQueue: () => readQueue(fx.cfg),
      runJob: job => runJob(job, d),
    });
  }

  it('syncs queued merges in order, one commit each', async () => {
    const first = land(fx, 30, limitTo5);
    const second = land(fx, 31, {'src/common/locks/lock.ts': 'export const LOCK = 2;\n'});
    scriptClaude(fx, [{edits: [flowTo5]}, {}]);

    assert.deepEqual(await worker(fx).tick(), {kind: 'drained', jobs: 2});
    assert.deepEqual(remote(fx, 'log', '-2', '--format=%s').split('\n').map(s => s.split(' (')[0]), [
      'backend: #31 senkronu',
      'backend: #30 senkronu',
    ]);
    assert.match(claudeCalls(fx)[0].stdin, new RegExp(`HEAD: ${short(fx, first)}`));
    assert.match(claudeCalls(fx)[1].stdin, new RegExp(`HEAD: ${short(fx, second)}`));
    assert.match(claudeCalls(fx)[1].stdin, /genel\/altyapi\.md {2}← sources: M src\/common\/locks\/lock\.ts/);
  });

  it('turns a backlog over the threshold into one job', async () => {
    for (const pr of [40, 41, 42, 43]) land(fx, pr, {[`src/common/n${pr}.ts`]: `export const N${pr} = 1;\n`});
    scriptClaude(fx, [{}]);
    assert.deepEqual(await worker(fx).tick(), {kind: 'drained', jobs: 1});
    assert.match(remote(fx, 'log', '-1', '--format=%s'), /^backend: #40, #41, #42, #43 senkronu/);
  });
});
