import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {generateEngineDocs, type KbDoc} from '@ai-knowledge-engine/kb';
import {isIrrelevant} from '../src/changes.ts';
import {loadAreaConfigs} from '../src/config.ts';
import {computeEngineImpact} from '../src/engine-impact.ts';
import {defaultClaude, JobFailed, readQueue, runJob} from '../src/job.ts';
import {nextJob} from '../src/queue.ts';
import {goIdentifiers} from '../src/validate.ts';
import {claudeCalls, CODE_FILES, git, initRepo, PROMPTS_DIR, read, scriptClaude, tmpDir, write} from './helpers/repos.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

describe('match engine area', () => {
  it('is added when ENGINE_REPO is set', () => {
    const configs = loadAreaConfigs({KB_REPO: '/k', CODE_REPO: '/c', FRONTEND_REPO: '/f', ENGINE_REPO: '/e', ENGINE_BRANCH: 'dev'});
    assert.deepEqual(configs.map(c => c.area), ['backend', 'frontend', 'mac-motoru']);
    assert.equal(configs[2].codeRepo, '/e');
    assert.equal(configs[2].codeBranch, 'dev');
    assert.equal(configs[2].backendRepo, undefined);
    assert.deepEqual(loadAreaConfigs({KB_REPO: '/k', CODE_REPO: '/c', ENGINE_REPO: '/e'}).map(c => c.area), ['backend', 'mac-motoru']);
  });

  it('ignores Go tests, go.sum and images', () => {
    assert.ok(isIrrelevant('internal/ai/attr_test.go'));
    assert.ok(isIrrelevant('go.sum'));
    assert.ok(isIrrelevant('analysis/out/formation_snapshot.png'));
    assert.ok(!isIrrelevant('internal/ai/attr.go'));
    assert.ok(!isIrrelevant('analysis/out/gk_model.json'));
  });

  it('checks mixed-case Go names in backticks', () => {
    assert.deepEqual(goIdentifiers('`attrFactor(stat, gain)` değil; `Attr.DribbleFactor`, `fixtureAttrShifts()`, `gk_model.json`, `pres`, `PVP_X`'), [
      'DribbleFactor',
      'fixtureAttrShifts',
    ]);
  });
});

describe('computeEngineImpact', () => {
  const doc = (p: string, meta: Record<string, unknown>): KbDoc => ({path: p, meta, body: ''});
  const docs = [
    doc('flows/kaleci/kurtaris.md', {sources: ['internal/match/match.go'], models: ['analysis/out/gk_model.json'], metrics: ['metrikler/diving.md']}),
    doc('genel/veri-ve-modeller.md', {}),
    doc('genel/altyapi.md', {}),
    doc('genel/metriklerin-etkisi.md', {}),
    doc('flows/statlar/oyun-stilleri.md', {}),
    doc('metrikler/diving.md', {}),
  ];

  it('uses sources and models, categories, new files, and changed metric cards with their flows', () => {
    const impact = computeEngineImpact(
      [
        {status: 'M', path: 'analysis/out/gk_model.json'},
        {status: 'A', path: 'analysis/out/new_model.json'},
        {status: 'M', path: 'k8s/batch-cronjobs.yaml'},
        {status: 'M', path: 'internal/ai/attr.go'},
        {status: 'A', path: 'internal/match/penalty.go'},
      ],
      docs,
      ['metrikler/diving.md', 'metrikler/new-stat.md', 'genel/oyun-stilleri.md'],
      new Set(['metrikler/new-stat.md']),
    );
    const r = (p: string) => impact.docs.get(p)?.join(' | ') ?? '';
    assert.match(r('flows/kaleci/kurtaris.md'), /sources: M analysis\/out\/gk_model\.json/);
    assert.match(r('flows/kaleci/kurtaris.md'), /aynı klasöre yeni dosya eklendi: internal\/match\/penalty\.go/);
    assert.match(r('flows/kaleci/kurtaris.md'), /kullandığı statın motordaki etkisi değişti: metrikler\/diving\.md/);
    assert.match(r('genel/veri-ve-modeller.md'), /kategori: analysis\/out\/new_model\.json/);
    assert.doesNotMatch(r('genel/veri-ve-modeller.md'), /gk_model/, 'değişen model dosyası kategoriye değil, onu okuyan akışa gider');
    assert.match(r('genel/altyapi.md'), /kategori: k8s/);
    assert.match(r('genel/metriklerin-etkisi.md'), /kategori: internal\/ai\/attr\.go/);
    assert.match(r('genel/metriklerin-etkisi.md'), /üretilmiş tablo değişti: genel\/oyun-stilleri\.md/);
    assert.match(r('flows/statlar/oyun-stilleri.md'), /üretilmiş tablo değişti/);
    assert.match(r('metrikler/new-stat.md'), /YENİ kart/);
    assert.match(r('metrikler/diving.md'), /yeniden üretildi/);
  });
});

const ENGINE_FILES: Record<string, string> = {
  'go.mod': 'module match-engine\n\ngo 1.26\n',
  'internal/ai/attr.go': [
    'package ai',
    '',
    'type Attr struct {',
    '\tSprintSpeed float64 // movement.sprintSpeed -> top speed',
    '}',
    '',
    'const attrAvg = 70.0',
    '',
    'func attrFactor(stat float64, gain float64) float64 {',
    '\treturn 1 + gain*(stat-attrAvg)/30.0',
    '}',
    '',
    '// SpeedFactor scales top speed.',
    'func (a Attr) SpeedFactor() float64 {',
    '\treturn attrFactor(a.SprintSpeed, 0.12)',
    '}',
    '',
  ].join('\n'),
  'internal/ai/player_brain.go': 'package ai\n\nfunc (pb *PlayerBrain) SetAttr(a Attr) {\n\tpb.speed *= pb.attr.SpeedFactor()\n}\n',
  'internal/lineup/attr_bridge.go':
    'package lineup\n\nfunc AttrFromPlayer(p models.TeamPlayer) ai.Attr {\n\td := p.DetailedStats\n\tpace := boost("pace")\n\ta := ai.Attr{\n\t\tSprintSpeed: eff(d.Movement.SprintSpeed, 0.55, pace),\n\t}\n\treturn a\n}\n',
  'internal/models/player.go': [
    'package models',
    '',
    'type DetailedMovementStats struct {',
    '\tSprintSpeed int `bson:"sprintSpeed" json:"sprintSpeed"`',
    '}',
    '',
    'type DetailedStats struct {',
    '\tMovement DetailedMovementStats `bson:"movement" json:"movement"`',
    '}',
    '',
  ].join('\n'),
};

describe('match engine job (uçtan uca)', () => {
  let root: string;
  let engineSeed: string;
  let kbSeed: string;
  let kbBare: string;
  let fakeState: string;
  let cfg: ReturnType<typeof loadAreaConfigs>[1];

  beforeEach(() => {
    root = tmpDir();
    const backend = path.join(root, 'backend');
    initRepo(backend, CODE_FILES);
    engineSeed = path.join(root, 'engine-seed');
    initRepo(engineSeed, ENGINE_FILES);
    git(root, 'clone', '--quiet', '--bare', engineSeed, path.join(root, 'engine.git'));
    git(engineSeed, 'remote', 'add', 'origin', path.join(root, 'engine.git'));
    git(root, 'clone', '--quiet', path.join(root, 'engine.git'), path.join(root, 'engine'));

    kbSeed = path.join(root, 'kb-seed');
    initRepo(kbSeed, {
      'README.md': '# KB\n',
      'mac-motoru/README.md': '# Maç motoru\n',
      'mac-motoru/genel/metriklerin-etkisi.md': '---\ntype: overview\ntitle: Metriklerin etkisi\n---\n\n# Metriklerin etkisi\n',
      'mac-motoru/.source-commit': `${git(engineSeed, 'rev-parse', '--short=8', 'HEAD')}\n`,
      'mac-motoru/flows/mac-akisi/fizik.md': [
        '---',
        'type: flow',
        'module: mac-akisi',
        'title: Fizik',
        'status: canlıda',
        'aliases: ["hız"]',
        'sources:',
        '  - internal/ai/player_brain.go',
        'metrics:',
        '  - metrikler/sprint-speed.md',
        '---',
        '',
        '# Fizik',
        '',
        '## Sayılar ve etki büyüklüğü',
        '',
        'Üst hız `SpeedFactor` ile 0.12 gain alır ([sprint hızı](../../metrikler/sprint-speed.md)).',
        '',
      ].join('\n'),
    });
    generateEngineDocs({areaDir: path.join(kbSeed, 'mac-motoru'), sourceDir: engineSeed});
    const card = path.join(kbSeed, 'mac-motoru/metrikler/sprint-speed.md');
    fs.writeFileSync(card, fs.readFileSync(card, 'utf8').replace(/_TODO:[^\n]*/, 'Koşu hızını belirler.'));
    git(kbSeed, 'add', '--all');
    git(kbSeed, 'commit', '--quiet', '-m', 'mac-motoru kb');
    kbBare = path.join(root, 'kb.git');
    git(root, 'clone', '--quiet', '--bare', kbSeed, kbBare);
    git(root, 'clone', '--quiet', kbBare, path.join(root, 'kb'));

    fakeState = path.join(root, 'fake');
    fs.mkdirSync(fakeState);
    cfg = loadAreaConfigs({
      KB_REPO: path.join(root, 'kb'),
      CODE_REPO: backend,
      ENGINE_REPO: path.join(root, 'engine'),
      PROMPTS_DIR,
      CLAUDE_BIN: path.resolve(import.meta.dirname, 'fixtures/fake-claude.mjs'),
      GIT_AUTHOR_NAME: 'kbsync',
      GIT_AUTHOR_EMAIL: 'kbsync@example.invalid',
    })[1];
  });
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

  const sync = async () => {
    const {base, queue} = await readQueue(cfg);
    return runJob(nextJob(base, queue, 3)!, {cfg, log: () => {}, now: () => new Date(2026, 9, 1), claude: defaultClaude(cfg)});
  };
  const commitEngine = (files: Record<string, string>, msg: string) => {
    for (const [rel, content] of Object.entries(files)) write(engineSeed, rel, content);
    git(engineSeed, 'add', '--all');
    git(engineSeed, 'commit', '--quiet', '-m', msg);
    git(engineSeed, 'push', '--quiet', 'origin', 'main');
  };
  const faster = {'internal/ai/attr.go': ENGINE_FILES['internal/ai/attr.go'].replace('0.12)', '0.15)')};

  it('regenerates metric cards, sends them and the flows using the stat to Claude, and commits as mac-motoru', async () => {
    commitEngine(faster, 'Speed gain 0.12 -> 0.15');
    scriptClaude({fakeState}, [{edits: [{path: 'mac-motoru/flows/mac-akisi/fizik.md', replace: ['0.12 gain', '0.15 gain']}]}]);
    await sync();

    const [call] = claudeCalls({fakeState});
    assert.match(call.stdin, /metrikler\/sprint-speed\.md {2}← kart yeniden üretildi/);
    assert.match(call.stdin, /flows\/mac-akisi\/fizik\.md {2}← kullandığı statın motordaki etkisi değişti: metrikler\/sprint-speed\.md/);
    assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1], /maçlarını oynatan motorun/);

    const show = (f: string) => git(kbBare, 'show', `main:${f}`);
    assert.match(git(kbBare, 'log', '-1', '--format=%s'), /^mac-motoru: [0-9a-f]{8} senkronu/);
    assert.match(show('mac-motoru/metrikler/sprint-speed.md'), /`attrFactor\(a.SprintSpeed, 0.15\)` \| ×0.90 … ×1.10/);
    assert.match(show('mac-motoru/metrikler/sprint-speed.md'), /Koşu hızını belirler\./, 'yazılmış paragraf korunur');
    assert.match(show('mac-motoru/flows/mac-akisi/fizik.md'), /0\.15 gain/);
    assert.equal(show('mac-motoru/.source-commit'), git(engineSeed, 'rev-parse', '--short=8', 'HEAD'));
    assert.equal(read(kbSeed, 'README.md').trim(), show('README.md'));
  });

  it('rejects a Go name that is not in the engine code', async () => {
    commitEngine(faster, 'Speed gain');
    scriptClaude({fakeState}, [
      {edits: [{path: 'mac-motoru/flows/mac-akisi/fizik.md', replace: ['`SpeedFactor`', '`HayaliSpeedFactor`']}]},
      {},
      {},
    ]);
    await assert.rejects(sync(), (e: unknown) => e instanceof JobFailed && /`HayaliSpeedFactor` kodda bulunamadı/.test(e.message));
  });
});
