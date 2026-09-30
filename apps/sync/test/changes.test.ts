import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {isIrrelevant, parseNameStatus, relevantChanges} from '../src/changes.ts';

describe('parseNameStatus', () => {
  it('parses additions, modifications, deletions, renames, copies and type changes', () => {
    const out = parseNameStatus(
      [
        'A\tsrc/a.ts',
        'M\tsrc/b.ts',
        'D\tsrc/c.ts',
        'R087\tsrc/old.ts\tsrc/new.ts',
        'C100\tsrc/x.ts\tsrc/y.ts',
        'T\tsrc/link.ts',
        '',
      ].join('\n'),
    );
    assert.deepEqual(out, [
      {status: 'A', path: 'src/a.ts'},
      {status: 'M', path: 'src/b.ts'},
      {status: 'D', path: 'src/c.ts'},
      {status: 'R', oldPath: 'src/old.ts', path: 'src/new.ts'},
      {status: 'A', path: 'src/y.ts'},
      {status: 'M', path: 'src/link.ts'},
    ]);
  });
});

describe('isIrrelevant', () => {
  for (const p of [
    'src/modules/pvp/usecases/start.usecase.spec.ts',
    'test/e2e/app.e2e.ts',
    'src/modules/x/__tests__/a.ts',
    'README.md',
    'docs/NOTES.MD',
    'pnpm-lock.yaml',
    'package-lock.json',
    '.gitlab-ci.yml',
    '.husky/pre-commit',
  ]) {
    it(`ignores ${p}`, () => assert.equal(isIrrelevant(p), true));
  }
  for (const p of [
    'src/modules/pvp/usecases/start.usecase.ts',
    '.github/workflows/deploy.yaml',
    'k8s/cronjobs.yaml',
    'package.json',
    '.env.example',
  ]) {
    it(`keeps ${p}`, () => assert.equal(isIrrelevant(p), false));
  }
});

describe('relevantChanges', () => {
  it('keeps a rename when either side is relevant', () => {
    const out = relevantChanges([
      {status: 'R', oldPath: 'src/a.ts', path: 'src/a.spec.ts'},
      {status: 'R', oldPath: 'x.md', path: 'y.md'},
      {status: 'M', path: 'pnpm-lock.yaml'},
    ]);
    assert.deepEqual(out, [{status: 'R', oldPath: 'src/a.ts', path: 'src/a.spec.ts'}]);
  });
});
