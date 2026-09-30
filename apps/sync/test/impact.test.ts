import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {Change} from '../src/changes.ts';
import type {KbDoc} from '@ai-knowledge-engine/kb';
import {cardPath, computeImpact, exportedNames, isUsecaseFile, moduleOf, type CodeView} from '../src/impact.ts';

const doc = (path: string, meta: Record<string, unknown> = {}, body = ''): KbDoc => ({path, meta, body});

function view(files: Record<string, string> = {}, modules: string[] = ['pvp-match']): CodeView {
  return {
    read: async c => files[c.path] ?? null,
    moduleExists: m => modules.includes(m),
  };
}

const card = (module: string, name: string, manual: string, generated: string) =>
  doc(`usecases/${module}/${name}.md`, {type: 'usecase'}, `${manual}\n<!-- gen:start -->\n${generated}\n<!-- gen:end -->\n`);

describe('path helpers', () => {
  it('finds the module of a path', () => {
    assert.equal(moduleOf('src/modules/pvp-match/usecases/a.usecase.ts'), 'pvp-match');
    assert.equal(moduleOf('src/common/x.ts'), null);
  });

  it('recognises use case files, nested ones included, but not specs', () => {
    assert.equal(isUsecaseFile('src/modules/building/stadium/usecases/x.usecase.ts'), true);
    assert.equal(isUsecaseFile('src/modules/a/usecases/x.usecase.spec.ts'), false);
    assert.equal(isUsecaseFile('src/modules/a/domain/x.ts'), false);
  });

  it('maps nested use cases to the module card folder', () => {
    assert.equal(cardPath('src/modules/building/stadium/usecases/upgrade.usecase.ts'), 'usecases/building/upgrade.usecase.md');
  });

  it('lists exported names of four characters or more', () => {
    const src = 'export const PVP_DAILY_LIMIT = 3;\nexport enum Tier {A}\nexport function calcReward() {}\nexport const X = 1;\nconst HIDDEN = 2;';
    assert.deepEqual(exportedNames(src), ['PVP_DAILY_LIMIT', 'Tier', 'calcReward']);
  });
});

describe('computeImpact', () => {
  const flow = doc('flows/pvp/gunluk-hak.md', {module: 'pvp-match', sources: ['src/modules/pvp-match/domain/constants/pvp.constant.ts']}, 'Günlük hak `PVP_DAILY_LIMIT`.');
  const moduleDoc = doc('modules/pvp-match.md', {module: 'pvp-match', sources: []}, 'PvP');
  const altyapi = doc('genel/altyapi.md', {}, '');
  const veri = doc('genel/veri-haritasi.md', {}, '');
  const genelBakis = doc('genel/genel-bakis.md', {}, '');
  const dis = doc('genel/dis-sistemler.md', {}, '');
  const cron = doc('genel/operasyon/cron-isleri.md', {}, '');
  const scripts = doc('genel/operasyon/elle-calistirilan-scriptler.md', {}, '');
  const all = [flow, moduleDoc, altyapi, veri, genelBakis, dis, cron, scripts];

  it('uses sources: as a reverse index, renames included', async () => {
    const impact = await computeImpact(
      [{status: 'R', oldPath: 'src/modules/pvp-match/domain/constants/pvp.constant.ts', path: 'src/modules/pvp-match/domain/constants/limits.constant.ts'}],
      all,
      view(),
    );
    assert.match(impact.docs.get('flows/pvp/gunluk-hak.md')!.join(), /taşındı/);
  });

  it('adds documents quoting a changed constant, and regenerates cards whose table quotes it', async () => {
    const other = doc('flows/lig/odul.md', {}, 'Ödül `PVP_DAILY_LIMIT` ile ilişkili.');
    const tableOnly = card('league', 'x.usecase', '## Ne yapar\n\nLig.', '| `PVP_DAILY_LIMIT` | 3 |');
    const manualToo = card('pvp-match', 'y.usecase', '## Ne yapar\n\n`PVP_DAILY_LIMIT` kadar.', '| `PVP_DAILY_LIMIT` | 3 |');
    const path = 'src/modules/pvp-match/domain/constants/pvp.constant.ts';
    const impact = await computeImpact([{status: 'M', path}], [...all, other, tableOnly, manualToo], view({[path]: 'export const PVP_DAILY_LIMIT = 5;'}, ['pvp-match', 'league']));
    assert.ok(impact.docs.has('flows/lig/odul.md'));
    assert.ok(!impact.docs.has('usecases/league/x.usecase.md'), 'yalnız tabloda geçen kart AI listesine girmez');
    assert.ok(impact.docs.has('usecases/pvp-match/y.usecase.md'));
    assert.deepEqual(impact.cardModules, ['league', 'pvp-match']);
  });

  it('reads the old content of a deleted constants file', async () => {
    const path = 'src/modules/pvp-match/domain/constants/pvp.constant.ts';
    let asked: Change | null = null;
    const v: CodeView = {read: async c => ((asked = c), 'export const PVP_DAILY_LIMIT = 3;'), moduleExists: () => true};
    const impact = await computeImpact([{status: 'D', path}], all, v);
    assert.equal(asked!.status, 'D');
    assert.match(impact.docs.get('flows/pvp/gunluk-hak.md')!.join(), /sabit: PVP_DAILY_LIMIT/);
  });

  it('applies the category rules', async () => {
    const changes: Change[] = [
      {status: 'M', path: 'src/modules/user/infra/user.schema.ts'},
      {status: 'M', path: 'src/bootstrap/config/env.schema.ts'},
      {status: 'M', path: 'k8s/cronjobs.yaml'},
      {status: 'M', path: 'package.json'},
      {status: 'A', path: 'src/modules/iap/presentation/rest/revenuecat-webhook.controller.ts'},
    ];
    const impact = await computeImpact(changes, all, view({}, []));
    for (const d of ['genel/veri-haritasi.md', 'genel/altyapi.md', 'genel/operasyon/cron-isleri.md', 'genel/operasyon/elle-calistirilan-scriptler.md', 'genel/dis-sistemler.md']) {
      assert.ok(impact.docs.has(d), d);
    }
  });

  it('detects @Schema and internal controllers from content', async () => {
    const files = {
      'src/modules/a/infra/a.model.ts': '@Schema({collection: "a"})\nexport class A {}',
      'src/modules/b/presentation/b.controller.ts': "@Controller('internal/b')\nexport class B {}",
    };
    const impact = await computeImpact(
      [{status: 'M', path: 'src/modules/a/infra/a.model.ts'}, {status: 'M', path: 'src/modules/b/presentation/b.controller.ts'}],
      all,
      view(files, ['a', 'b']),
    );
    assert.ok(impact.docs.has('genel/veri-haritasi.md'));
    assert.ok(impact.docs.has('genel/dis-sistemler.md'));
  });

  it('routes resolver changes to the module document and its flows', async () => {
    const impact = await computeImpact([{status: 'M', path: 'src/modules/pvp-match/presentation/pvp.resolver.ts'}], all, view());
    assert.ok(impact.docs.has('modules/pvp-match.md'));
    assert.ok(impact.docs.has('flows/pvp/gunluk-hak.md'));
  });

  it('handles added, modified and deleted use cases', async () => {
    const existingCard = card('pvp-match', 'start-pvp.usecase', '## Ne yapar\n\nBaşlatır.', 'x');
    const deletedCard = card('pvp-match', 'old.usecase', '## Ne yapar\n\nEski.', 'y');
    const impact = await computeImpact(
      [
        {status: 'A', path: 'src/modules/pvp-match/usecases/new.usecase.ts'},
        {status: 'M', path: 'src/modules/pvp-match/usecases/start-pvp.usecase.ts'},
        {status: 'D', path: 'src/modules/pvp-match/usecases/old.usecase.ts'},
      ],
      [...all, existingCard, deletedCard],
      view(),
    );
    assert.deepEqual(impact.cardModules, ['pvp-match']);
    assert.match(impact.docs.get('usecases/pvp-match/new.usecase.md')!.join(), /YENİ kart/);
    assert.match(impact.docs.get('usecases/pvp-match/start-pvp.usecase.md')!.join(), /yeniden üretildi/);
    assert.match(impact.docs.get('usecases/pvp-match/old.usecase.md')!.join(), /kaldırıldı/);
  });

  it('flags new and removed modules', async () => {
    const gone = doc('modules/gone.md', {}, '');
    const impact = await computeImpact(
      [
        {status: 'A', path: 'src/modules/fresh/fresh.module.ts'},
        {status: 'D', path: 'src/modules/gone/gone.module.ts'},
      ],
      [...all, gone],
      view({}, ['fresh', 'pvp-match']),
    );
    assert.deepEqual(impact.newModules, ['fresh']);
    assert.deepEqual(impact.removedModules, ['gone']);
    assert.ok(impact.docs.has('genel/genel-bakis.md'));
    assert.match(impact.docs.get('modules/gone.md')!.join(), /kaldırıldı/);
  });

  it('does not regenerate cards of a module that no longer exists', async () => {
    const impact = await computeImpact([{status: 'D', path: 'src/modules/gone/usecases/a.usecase.ts'}], all, view({}, []));
    assert.deepEqual(impact.cardModules, []);
  });

  it('returns an empty impact for changes nothing documents', async () => {
    const impact = await computeImpact([{status: 'M', path: 'src/modules/pvp-match/domain/helper.ts'}], all, view());
    assert.equal(impact.docs.size, 0);
    assert.deepEqual(impact.newModules, []);
  });
});
