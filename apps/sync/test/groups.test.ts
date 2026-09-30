import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {groupKey, planGroups} from '../src/groups.ts';
import type {Impact} from '../src/impact.ts';
import {mergeReports} from '../src/job.ts';

const impactOf = (...docs: string[]): Impact => ({
  docs: new Map(docs.map(d => [d, ['neden']])),
  cardModules: ['m'],
  newModules: [],
  removedModules: [],
});

describe('groupKey', () => {
  it('groups by module or flow area, genel apart', () => {
    assert.equal(groupKey('modules/kyc.md'), 'kyc');
    assert.equal(groupKey('usecases/kyc/a.usecase.md'), 'kyc');
    assert.equal(groupKey('flows/pro-kayit/x.md'), 'flows/pro-kayit');
    assert.equal(groupKey('genel/operasyon/cron-isleri.md'), 'genel');
  });
});

describe('planGroups', () => {
  it('keeps small jobs in one call', () => {
    const impact = impactOf('flows/a/x.md', 'modules/a.md');
    assert.deepEqual(planGroups(impact, 40), [impact]);
  });

  it('splits by group, never splitting one group, with genel last', () => {
    const impact = impactOf(
      'genel/altyapi.md',
      'modules/kyc.md',
      'usecases/kyc/a.usecase.md',
      'usecases/kyc/b.usecase.md',
      'flows/pro-kayit/x.md',
      'flows/pro-kayit/y.md',
      'modules/admin.md',
    );
    const groups = planGroups(impact, 3).map(g => [...g.docs.keys()]);
    assert.deepEqual(groups, [
      ['flows/pro-kayit/x.md', 'flows/pro-kayit/y.md', 'modules/admin.md'],
      ['modules/kyc.md', 'usecases/kyc/a.usecase.md', 'usecases/kyc/b.usecase.md'],
      ['genel/altyapi.md'],
    ]);
    assert.ok(planGroups(impact, 3).every(g => g.cardModules[0] === 'm'), 'diğer alanlar korunur');
  });

  it('lets one oversized group stand alone', () => {
    const impact = impactOf('usecases/kyc/a.md', 'usecases/kyc/b.md', 'usecases/kyc/c.md', 'modules/x.md');
    assert.deepEqual(planGroups(impact, 2).map(g => g.docs.size), [1, 3]);
  });
});

describe('mergeReports', () => {
  it('concatenates every list', () => {
    const empty = {updated: [], created: [], retired: [], no_change: [], value_changes: [], findings: [], open_questions: []};
    const a = {...empty, updated: [{path: 'a', sections: [], reason: 'r'}], open_questions: ['s1']};
    const b = {...empty, updated: [{path: 'b', sections: [], reason: 'r'}], open_questions: ['s2']};
    const merged = mergeReports([a, b]);
    assert.deepEqual(merged.updated.map(u => u.path), ['a', 'b']);
    assert.deepEqual(merged.open_questions, ['s1', 's2']);
    assert.deepEqual(mergeReports([]), empty);
  });
});
