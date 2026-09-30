import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {GEN_END, GEN_START, generateCards, genBlock, manualPart} from '../src/cards.ts';
import {parseDoc} from '../src/docs.ts';
import {initRepo, read, tmpDir, write} from './helpers.ts';

const CODE: Record<string, string> = {
  'tsconfig.json': JSON.stringify({compilerOptions: {target: 'ES2022', experimentalDecorators: true}}),
  'src/modules/pvp-match/pvp-match.module.ts':
    "import {StartPvpUseCase} from './usecases/start-pvp.usecase';\n@Module({providers: [StartPvpUseCase], exports: [StartPvpUseCase]})\nexport class PvpMatchModule {}\n",
  'src/modules/pvp-match/domain/constants/pvp.constant.ts': 'export const PVP_DAILY_LIMIT = 3;\n',
  'src/modules/pvp-match/domain/errors/limit.error.ts':
    "export class PvpLimitError extends Error {\n  code = 'PVP_DAILY_LIMIT_REACHED';\n  status = HttpStatus.FORBIDDEN;\n}\n",
  'src/modules/pvp-match/usecases/start-pvp.usecase.ts': [
    "import {PVP_DAILY_LIMIT} from '../domain/constants/pvp.constant';",
    "import {PvpLimitError} from '../domain/errors/limit.error';",
    'export interface StartPvpInput {',
    '  /** Oyuncu */',
    '  userId: string;',
    '}',
    '/** Starts a PvP match if the daily allowance is not used up. */',
    'export class StartPvpUseCase {',
    '  constructor(private readonly repo: PvpRepository) {}',
    '  async execute(input: StartPvpInput): Promise<boolean> {',
    '    const used = await this.repo.countToday(input.userId);',
    '    if (used >= PVP_DAILY_LIMIT) throw new PvpLimitError();',
    '    return true;',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/modules/pvp-match/presentation/pvp.resolver.ts': [
    "import {StartPvpUseCase} from '../usecases/start-pvp.usecase';",
    'export class PvpResolver {',
    '  constructor(private readonly startPvpUseCase: StartPvpUseCase) {}',
    "  @Mutation(() => Boolean, {name: 'startPvp'})",
    '  start(userId: string) {',
    '    return this.startPvpUseCase.execute({userId});',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/modules/building/stadium/usecases/upgrade-stadium.usecase.ts': 'export class UpgradeStadiumUseCase {\n  execute() {}\n}\n',
  'src/modules/building/usecases/helpers.ts': 'export const HELPER = 1;\n',
};

describe('generateCards', () => {
  let root: string;
  let code: string;
  let area: string;
  const card = 'usecases/pvp-match/start-pvp.usecase.md';

  before(() => {
    root = tmpDir();
    code = path.join(root, 'code');
    area = path.join(root, 'kb/backend');
    initRepo(code, CODE);
  });
  after(() => fs.rmSync(root, {recursive: true, force: true}));

  it('writes a card per use case class with frontmatter, a TODO paragraph and the generated block', () => {
    const counts = generateCards({areaDir: area, sourceDir: code, modules: ['pvp-match']});
    assert.deepEqual(counts, {'pvp-match': 1});

    const text = read(area, card);
    const {meta} = parseDoc(text);
    assert.equal(meta.type, 'usecase');
    assert.equal(meta.module, 'pvp-match');
    assert.equal(meta.name, 'StartPvpUseCase');
    assert.equal(meta.source, 'src/modules/pvp-match/usecases/start-pvp.usecase.ts');
    assert.match(String(meta.code_commit), /^[0-9a-f]{8}$/);
    assert.match(text, /## Ne yapar\n\n_TODO: 2-3 cümle/);
    assert.ok(text.indexOf(GEN_START) < text.indexOf(GEN_END));
  });

  it('describes the use case from code: input, dependencies, calls, constants, errors, callers', () => {
    const block = genBlock(read(area, card))!;
    assert.match(block, /Diğer modüllere açık mı:\*\* Evet/);
    assert.match(block, /> Starts a PvP match if the daily allowance is not used up\./);
    assert.match(block, /\| `userId` \| `string` \| Oyuncu \|/);
    assert.match(block, /\| `repo` \| `PvpRepository` \|/);
    assert.match(block, /\| `execute` \| `repo\.countToday` \| `input\.userId` \|/);
    assert.match(block, /\| `PVP_DAILY_LIMIT` \| `3` \| `src\/modules\/pvp-match\/domain\/constants\/pvp\.constant\.ts:1` \|/);
    assert.match(block, /\| `PvpLimitError` \| `PVP_DAILY_LIMIT_REACHED` \| FORBIDDEN \|/);
    assert.match(block, /GraphQL Mutation `startPvp`.*PvpResolver\.start/);
  });

  it('keeps the written paragraph and rewrites only the generated block', () => {
    write(area, card, read(area, card).replace(/_TODO:[^\n]*/, 'PvP maçını başlatır.'));
    write(code, 'src/modules/pvp-match/domain/constants/pvp.constant.ts', 'export const PVP_DAILY_LIMIT = 5;\n');
    generateCards({areaDir: area, sourceDir: code, modules: ['pvp-match']});
    const text = read(area, card);
    assert.match(manualPart(text), /PvP maçını başlatır\./);
    assert.match(genBlock(text)!, /\| `PVP_DAILY_LIMIT` \| `5` \|/);
  });

  it('puts nested use cases in the module folder and skips files without classes', () => {
    const counts = generateCards({areaDir: area, sourceDir: code, modules: ['building']});
    assert.deepEqual(counts, {building: 1});
    assert.ok(fs.existsSync(path.join(area, 'usecases/building/upgrade-stadium.usecase.md')));
    assert.ok(!fs.existsSync(path.join(area, 'usecases/building/helpers.md')));
  });

  it('does nothing for an empty module list', () => {
    assert.deepEqual(generateCards({areaDir: area, sourceDir: code, modules: []}), {});
  });
});

describe('genBlock / manualPart', () => {
  const text = '## Ne yapar\n\nAçıklama.\n\n<!-- gen:start -->\nüretilmiş\n<!-- gen:end -->\n';

  it('splits a card into generated block and written part', () => {
    assert.equal(genBlock(text), '<!-- gen:start -->\nüretilmiş\n<!-- gen:end -->');
    assert.equal(manualPart(text), '## Ne yapar\n\nAçıklama.\n\n\n');
  });

  it('treats a card without markers as all written', () => {
    assert.equal(genBlock('işaretsiz'), null);
    assert.equal(manualPart('işaretsiz'), 'işaretsiz');
  });
});
