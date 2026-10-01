import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';
import {generateFrontendDocs, type KbDoc} from '@ai-knowledge-engine/kb';
import {loadAreaConfigs} from '../src/config.ts';
import {computeFrontendImpact} from '../src/frontend-impact.ts';
import {defaultClaude, JobFailed, readQueue, runJob} from '../src/job.ts';
import {nextJob} from '../src/queue.ts';
import {runWorkers, type Worker} from '../src/worker.ts';
import {claudeCalls, CODE_FILES, git, initRepo, PROMPTS_DIR, read, scriptClaude, tmpDir, write} from './helpers/repos.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

describe('loadAreaConfigs', () => {
  it('adds the frontend area only when FRONTEND_REPO is set, pointing it at the backend clone', () => {
    assert.deepEqual(loadAreaConfigs({KB_REPO: '/k', CODE_REPO: '/c'}).map(c => c.area), ['backend']);
    const [b, f] = loadAreaConfigs({KB_REPO: '/k', CODE_REPO: '/c', FRONTEND_REPO: '/f', FRONTEND_BRANCH: 'develop'});
    assert.equal(b.area, 'backend');
    assert.equal(f.area, 'frontend');
    assert.equal(f.codeRepo, '/f');
    assert.equal(f.codeBranch, 'develop');
    assert.equal(f.backendRepo, '/c');
    assert.equal(f.kbRepo, b.kbRepo);
  });
});

describe('computeFrontendImpact', () => {
  const doc = (p: string, meta: Record<string, unknown>): KbDoc => ({path: p, meta, body: ''});
  const docs = [
    doc('flows/pvp/meydan-okuma.md', {sources: ['src/components/pvp/PvpPanel.tsx'], api: ['api/create-pvp-match.md']}),
    doc('genel/uzak-ayarlar.md', {sources: []}),
    doc('genel/mimari.md', {sources: []}),
    doc('api/create-pvp-match.md', {}),
    doc('ekranlar/pvp.md', {}),
  ];

  it('uses sources, categories, new files next to documented ones, and changed cards with their flows', () => {
    const impact = computeFrontendImpact(
      [
        {status: 'M', path: 'src/components/pvp/PvpPanel.tsx'},
        {status: 'M', path: 'src/lib/remoteConfig.ts'},
        {status: 'M', path: 'app/_layout.tsx'},
        {status: 'A', path: 'src/components/pvp/PvpHistory.tsx'},
      ],
      docs,
      ['api/create-pvp-match.md', 'api/pvp-history.md', 'genel/api-haritasi.md'],
      new Set(['api/pvp-history.md']),
    );
    const r = (p: string) => impact.docs.get(p)?.join(' | ') ?? '';
    assert.match(r('flows/pvp/meydan-okuma.md'), /sources: M src\/components\/pvp\/PvpPanel\.tsx/);
    assert.match(r('flows/pvp/meydan-okuma.md'), /aynı klasöre yeni dosya eklendi: src\/components\/pvp\/PvpHistory\.tsx/);
    assert.match(r('flows/pvp/meydan-okuma.md'), /çağırdığı işlem değişti: api\/create-pvp-match\.md/);
    assert.match(r('genel/uzak-ayarlar.md'), /kategori/);
    assert.match(r('genel/mimari.md'), /kategori: app\/_layout\.tsx/);
    assert.match(r('api/pvp-history.md'), /YENİ kart/);
    assert.match(r('api/create-pvp-match.md'), /yeniden üretildi/);
    assert.ok(!impact.docs.has('genel/api-haritasi.md'), 'tamamen üretilen genel belgeler Claude\'a gitmez');
  });
});

describe('runWorkers', () => {
  it('ticks every area in turn and waits for the latest usage-limit reset', async () => {
    const now = new Date(2026, 9, 1, 12, 0);
    const order: string[] = [];
    const fake = (name: string, result: object) =>
      ({pollIntervalMs: 120_000, tick: async () => (order.push(`${name}:tick`), result), afterTick: async () => void order.push(`${name}:index`)}) as unknown as Worker;
    const controller = new AbortController();
    const sleeps: number[] = [];
    await runWorkers(
      [fake('backend', {kind: 'idle'}), fake('frontend', {kind: 'limited', until: new Date(2026, 9, 1, 12, 30)})],
      controller.signal,
      async ms => {
        sleeps.push(ms);
        controller.abort();
      },
      () => now,
    );
    assert.deepEqual(order, ['backend:tick', 'backend:index', 'frontend:tick', 'frontend:index']);
    assert.deepEqual(sleeps, [30 * 60_000]);
  });
});

const APP_FILES: Record<string, string> = {
  'app/_layout.tsx': 'export default function Root() { return null; }\n',
  'app/pvp.tsx': "import {PvpPanel} from '@/components/pvp/PvpPanel';\nexport default function Pvp() { return <PvpPanel />; }\n",
  'src/components/pvp/PvpPanel.tsx':
    "import {useMutation} from '@apollo/client';\nimport {CreatePvpMatchMutation} from '@/graphql/pvp';\nexport function PvpPanel() {\n  useMutation(CreatePvpMatchMutation);\n  return null;\n}\n",
  'src/graphql/pvp.ts':
    "import {graphql} from '@/gql';\nexport const CreatePvpMatchMutation = graphql(`\n  mutation CreatePvpMatch {\n    createPvpMatch { id }\n  }\n`);\n",
};

describe('frontend job (uçtan uca)', () => {
  let root: string;
  let appSeed: string;
  let kbSeed: string;
  let kbBare: string;
  let fakeState: string;
  let cfg: ReturnType<typeof loadAreaConfigs>[1];

  beforeEach(() => {
    root = tmpDir();
    const backend = path.join(root, 'backend');
    initRepo(backend, {
      ...CODE_FILES,
      'src/modules/pvp-match/presentation/pvp.resolver.ts':
        '@Resolver()\nexport class P {\n  @Mutation(() => Boolean)\n  createPvpMatch() {}\n  @Mutation(() => Boolean)\n  cancelPvpMatch() {}\n}\n',
    });
    appSeed = path.join(root, 'app-seed');
    initRepo(appSeed, APP_FILES);
    git(root, 'clone', '--quiet', '--bare', appSeed, path.join(root, 'app.git'));
    git(appSeed, 'remote', 'add', 'origin', path.join(root, 'app.git'));
    git(root, 'clone', '--quiet', path.join(root, 'app.git'), path.join(root, 'app'));

    kbSeed = path.join(root, 'kb-seed');
    initRepo(kbSeed, {
      'README.md': '# KB\n',
      'backend/flows/pvp/meydan-okuma.md': '---\ntitle: PvP meydan okuma\nstatus: canlıda\n---\n\n# PvP\n\n## Kural\n\n`createPvpMatch` ile.\n',
      'frontend/README.md': '# Frontend\n',
      'frontend/.source-commit': `${git(appSeed, 'rev-parse', '--short=8', 'HEAD')}\n`,
      'frontend/flows/pvp/meydan-okuma.md': [
        '---',
        'type: flow',
        'module: pvp',
        'title: PvP meydan okuma',
        'status: canlıda',
        'aliases: ["pvp daveti"]',
        'sources:',
        '  - src/components/pvp/PvpPanel.tsx',
        'api:',
        '  - api/create-pvp-match.md',
        'backend:',
        '  - ../backend/flows/pvp/meydan-okuma.md',
        '---',
        '',
        '# PvP meydan okuma',
        '',
        '## Ne yapar',
        '',
        'Oyuncu [/pvp](../../ekranlar/pvp.md) ekranından davet gönderir ([CreatePvpMatch](../../api/create-pvp-match.md)).',
        '',
      ].join('\n'),
    });
    generateFrontendDocs({areaDir: path.join(kbSeed, 'frontend'), sourceDir: appSeed, backendDir: backend, backendAreaDir: path.join(kbSeed, 'backend')});
    for (const f of fs.readdirSync(path.join(kbSeed, 'frontend/api'))) {
      const p = path.join(kbSeed, 'frontend/api', f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/_TODO:[^\n]*/, 'PvP daveti gönderir.'));
    }
    for (const f of fs.readdirSync(path.join(kbSeed, 'frontend/ekranlar'))) {
      const p = path.join(kbSeed, 'frontend/ekranlar', f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/_TODO:[^\n]*/, 'Ekran.'));
    }
    git(kbSeed, 'add', '--all');
    git(kbSeed, 'commit', '--quiet', '-m', 'frontend kb');
    kbBare = path.join(root, 'kb.git');
    git(root, 'clone', '--quiet', '--bare', kbSeed, kbBare);
    git(root, 'clone', '--quiet', kbBare, path.join(root, 'kb'));

    fakeState = path.join(root, 'fake');
    fs.mkdirSync(fakeState);
    cfg = loadAreaConfigs({
      KB_REPO: path.join(root, 'kb'),
      CODE_REPO: backend,
      FRONTEND_REPO: path.join(root, 'app'),
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
  const commitApp = (files: Record<string, string>, msg: string) => {
    for (const [rel, content] of Object.entries(files)) write(appSeed, rel, content);
    git(appSeed, 'add', '--all');
    git(appSeed, 'commit', '--quiet', '-m', msg);
    git(appSeed, 'push', '--quiet', 'origin', 'main');
  };

  it('regenerates cards, sends new cards and affected flows to Claude, and commits as frontend', async () => {
    commitApp(
      {
        'src/graphql/pvp.ts': APP_FILES['src/graphql/pvp.ts'].replace(
          '`);\n',
          '`);\nexport const CancelPvpMatchMutation = graphql(`\n  mutation CancelPvpMatch {\n    cancelPvpMatch\n  }\n`);\n',
        ),
        'src/components/pvp/PvpPanel.tsx': APP_FILES['src/components/pvp/PvpPanel.tsx']
          .replace("import {CreatePvpMatchMutation} from '@/graphql/pvp';", "import {CancelPvpMatchMutation, CreatePvpMatchMutation} from '@/graphql/pvp';")
          .replace('  return null;', '  useMutation(CancelPvpMatchMutation);\n  return null;'),
      },
      'pvp: davet iptali (LCO-1)',
    );
    scriptClaude({fakeState}, [
      {
        edits: [
          {path: 'frontend/api/cancel-pvp-match.md', replace: ['_TODO: 1-2 cümle, iş diliyle: bu çağrı oyuncu için ne sağlar, ne zaman yapılır (AI doldurur)._', 'Gönderilen daveti geri çeker.']},
          {path: 'frontend/flows/pvp/meydan-okuma.md', replace: ['  - api/create-pvp-match.md', '  - api/create-pvp-match.md\n  - api/cancel-pvp-match.md']},
        ],
      },
    ]);
    await sync();

    const [call] = claudeCalls({fakeState});
    assert.match(call.stdin, /api\/cancel-pvp-match\.md {2}← YENİ kart/);
    assert.match(call.stdin, /flows\/pvp\/meydan-okuma\.md {2}← sources: M src\/components\/pvp\/PvpPanel\.tsx/);
    assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1], /mobil uygulamasının/);
    assert.equal(call.args[call.args.indexOf('--add-dir') + 1], cfg.codeRepo);

    const show = (f: string) => git(kbBare, 'show', `main:${f}`);
    assert.match(git(kbBare, 'log', '-1', '--format=%s'), /^frontend: [0-9a-f]{8} senkronu/);
    assert.match(show('frontend/api/cancel-pvp-match.md'), /Gönderilen daveti geri çeker\./);
    assert.match(show('frontend/genel/api-haritasi.md'), /`cancelPvpMatch` \| mutation \| \[CancelPvpMatch\]/);
    assert.equal(show('frontend/.source-commit'), git(appSeed, 'rev-parse', '--short=8', 'HEAD'));
    assert.equal(read(kbSeed, 'backend/flows/pvp/meydan-okuma.md').trim(), show('backend/flows/pvp/meydan-okuma.md'), 'backend alanına dokunulmaz');
  });

  it('rejects a frontend status value the area does not allow', async () => {
    commitApp({'src/components/pvp/PvpPanel.tsx': APP_FILES['src/components/pvp/PvpPanel.tsx'] + '// değişti\n'}, 'pvp: yorum');
    scriptClaude({fakeState}, [
      {edits: [{path: 'frontend/flows/pvp/meydan-okuma.md', replace: ['status: canlıda', "status: kod main'de, istemci bağlı değil"]}]},
      {},
      {},
    ]);
    await assert.rejects(sync(), (e: unknown) => e instanceof JobFailed && /status "kod main'de, istemci bağlı değil" izinli değil/.test(e.message));
  });
});
