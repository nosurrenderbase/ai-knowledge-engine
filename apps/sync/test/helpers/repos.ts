import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {generateCards} from '@ai-knowledge-engine/kb';
import type {Config} from '../../src/config.ts';

/** Root of this monorepo. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
export const PROMPTS_DIR = path.join(REPO_ROOT, 'prompts');
export const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');

export function tmpDir(prefix = 'kbsync-test-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {cwd, env: GIT_ENV, encoding: 'utf8'}).trim();
}

export function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** A fresh repo with an initial commit on main. */
export function initRepo(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(dir, {recursive: true});
  git(dir, 'init', '--quiet', '--initial-branch=main');
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git(dir, 'add', '--all');
  git(dir, 'commit', '--quiet', '-m', 'ilk');
}

/** Commits `files` on a feature branch and merges it into main with a GitHub-style merge commit. */
export function mergePr(dir: string, pr: number, files: Record<string, string | null>): string {
  git(dir, 'checkout', '--quiet', '-b', `pr-${pr}`);
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) git(dir, 'rm', '--quiet', rel);
    else write(dir, rel, content);
  }
  git(dir, 'add', '--all');
  git(dir, 'commit', '--quiet', '-m', `PR ${pr} değişikliği`);
  git(dir, 'checkout', '--quiet', 'main');
  git(dir, 'merge', '--quiet', '--no-ff', '-m', `Merge pull request #${pr} from org/pr-${pr}`, `pr-${pr}`);
  return git(dir, 'rev-parse', 'HEAD');
}

export const CODE_FILES: Record<string, string> = {
  'README.md': '# kod\n',
  'tsconfig.json': JSON.stringify({compilerOptions: {target: 'ES2022', experimentalDecorators: true}}),
  'src/modules/pvp-match/pvp-match.module.ts': 'export class PvpMatchModule {}\n',
  'src/modules/pvp-match/domain/constants/pvp.constant.ts': 'export const PVP_DAILY_LIMIT = 3;\n',
  'src/modules/pvp-match/usecases/start-pvp.usecase.ts':
    "import {PVP_DAILY_LIMIT} from '../domain/constants/pvp.constant';\nexport class StartPvpUseCase {\n  execute() {\n    return PVP_DAILY_LIMIT;\n  }\n}\n",
  'src/modules/pvp-match/presentation/pvp.resolver.ts':
    '@Resolver()\nexport class PvpResolver {\n  @Mutation(() => Boolean)\n  startPvp() {\n    return true;\n  }\n}\n',
  'src/common/locks/lock.ts': 'export const LOCK = 1;\n',
};

/** The "Durum" lines of the real backend README, which the worker keeps up to date. */
export const README_STATUS = [
  '# Backend bilgi tabanı',
  '',
  '## Durum',
  '',
  '- Kod commit: `00000000` (01.01.2026, main). `.source-commit` bunu tutar.',
  '- 1 modülün hepsi belgelendi: 1 akış dokümanı (`flows/`), 1 modül dokümanı (`modules/`), 1 use case kartı (`usecases/`, hepsinin "Ne yapar" paragrafı dolu).',
  '',
].join('\n');

function kbFiles(sourceCommit: string): Record<string, string> {
  return {
    'README.md': '# KB\n',
    'backend/.source-commit': `${sourceCommit}\n`,
    'backend/README.md': README_STATUS,
    'backend/flows/pvp/gunluk-hak.md': [
      '---',
      'type: flow',
      'module: pvp-match',
      'title: PvP günlük hak',
      'status: canlıda',
      'aliases: ["pvp hakkı", "günlük maç hakkı"]',
      `code_commit: ${sourceCommit}`,
      'sources:',
      '  - src/modules/pvp-match/domain/constants/pvp.constant.ts',
      '  - src/modules/pvp-match/usecases/start-pvp.usecase.ts',
      'related:',
      '  - modules/pvp-match.md',
      '---',
      '',
      '# PvP günlük hak',
      '',
      '## Kurallar ve baremler',
      '',
      'Günlük hak `PVP_DAILY_LIMIT` = 3 maç. Uç: `startPvp`. Bkz. [modül](../../modules/pvp-match.md).',
      '',
    ].join('\n'),
    'backend/modules/pvp-match.md': [
      '---',
      'type: module',
      'module: pvp-match',
      'title: PvP modülü',
      'aliases: ["pvp"]',
      `code_commit: ${sourceCommit}`,
      'sources:',
      '  - src/modules/pvp-match/pvp-match.module.ts',
      '---',
      '',
      '# PvP',
      '',
      '## Ne yapar',
      '',
      'Oyuncuya karşı maç. Akış: [günlük hak](../flows/pvp/gunluk-hak.md). Uç: `startPvp`.',
      '',
    ].join('\n'),
    'backend/genel/altyapi.md': [
      '---',
      'type: infra',
      'title: Altyapı',
      'aliases: ["altyapı"]',
      'sources:',
      '  - src/common/locks/lock.ts',
      '---',
      '',
      '# Altyapı',
      '',
      '## Kilit',
      '',
      'Kilit `LOCK` sabitiyle çalışır.',
      '',
    ].join('\n'),
  };
}

export interface Fixture {
  root: string;
  codeSeed: string;
  codeClone: string;
  kbSeed: string;
  kbClone: string;
  kbBare: string;
  fakeState: string;
  cfg: Config;
}

/**
 * Two bare "remotes" (code and knowledge base), a seed working copy of each to
 * create history with, and the worker's own clones. The knowledge base starts
 * synced to the code's initial commit, cards included.
 */
export function setupFixture(overrides: Partial<Config> = {}): Fixture {
  const root = tmpDir();
  const codeSeed = path.join(root, 'code-seed');
  const codeBare = path.join(root, 'code.git');
  const codeClone = path.join(root, 'code');
  initRepo(codeSeed, CODE_FILES);
  git(root, 'clone', '--quiet', '--bare', codeSeed, codeBare);
  git(codeSeed, 'remote', 'add', 'origin', codeBare);
  git(root, 'clone', '--quiet', codeBare, codeClone);
  const base = git(codeSeed, 'rev-parse', '--short=8', 'HEAD');

  const kbSeed = path.join(root, 'kb-seed');
  const kbBare = path.join(root, 'kb.git');
  const kbClone = path.join(root, 'kb');
  initRepo(kbSeed, kbFiles(base));
  // Cards come from the generator, like in the real repo.
  generateCards({areaDir: path.join(kbSeed, 'backend'), sourceDir: codeSeed, modules: ['pvp-match']});
  const card = 'backend/usecases/pvp-match/start-pvp.usecase.md';
  write(kbSeed, card, read(kbSeed, card).replace(/_TODO:[^\n]*/, 'PvP maçını başlatır; günlük hakkı kontrol eder. Akış: [günlük hak](../../flows/pvp/gunluk-hak.md).'));
  git(kbSeed, 'add', '--all');
  git(kbSeed, 'commit', '--quiet', '-m', 'kartlar');
  git(root, 'clone', '--quiet', '--bare', kbSeed, kbBare);
  git(kbSeed, 'remote', 'add', 'origin', kbBare);
  git(kbSeed, 'fetch', '--quiet', 'origin');
  git(kbSeed, 'branch', '--quiet', '--set-upstream-to=origin/main', 'main');
  git(root, 'clone', '--quiet', kbBare, kbClone);

  const fakeState = path.join(root, 'fake-claude');
  fs.mkdirSync(fakeState);
  const cfg: Config = {
    kbRepo: kbClone,
    kbRemote: 'origin',
    kbBranch: 'main',
    codeRepo: codeClone,
    codeRemote: 'origin',
    codeBranch: 'main',
    area: 'backend',
    pollIntervalMs: 1_000,
    batchThreshold: 3,
    maxAttempts: 3,
    validationRounds: 2,
    groupMaxDocs: 40,
    limitBackoffMs: 60_000,
    promptsDir: PROMPTS_DIR,
    claude: {bin: path.join(FIXTURES, 'fake-claude.mjs'), model: 'opus', maxTurns: 10, timeoutMs: 60_000},
    author: {name: 'kbsync', email: 'kbsync@example.invalid'},
    alertWebhookUrl: undefined,
    dryRun: false,
    ...overrides,
  };
  return {root, codeSeed, codeClone, kbSeed, kbClone, kbBare, fakeState, cfg};
}

export function cleanup(fx: Fixture): void {
  fs.rmSync(fx.root, {recursive: true, force: true});
}

/** Tells the fake `claude` what to do on each call (see fixtures/fake-claude.mjs). */
export function scriptClaude(fx: Pick<Fixture, 'fakeState'>, calls: object[]): void {
  fs.writeFileSync(path.join(fx.fakeState, 'script.json'), JSON.stringify(calls));
  process.env.FAKE_CLAUDE_DIR = fx.fakeState;
}

export interface RecordedCall {
  args: string[];
  stdin: string;
  cwd: string;
}

export function claudeCalls(fx: Pick<Fixture, 'fakeState'>): RecordedCall[] {
  const file = path.join(fx.fakeState, 'calls.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as RecordedCall);
}
