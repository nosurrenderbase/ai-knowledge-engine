import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {addedLines, backtickIdentifiers, markdownLinks, STATUSES} from '../src/validate.ts';

describe('addedLines', () => {
  it('returns lines of the new text that were not there before, counting duplicates', () => {
    assert.deepEqual(addedLines('a\nb\nb\n', 'a\nb\nb\nb\nc\n'), ['b', 'c']);
  });

  it('treats a new file as all added', () => {
    assert.deepEqual(addedLines(null, 'x\ny'), ['x', 'y']);
  });

  it('ignores moved lines', () => {
    assert.deepEqual(addedLines('a\nb', 'b\na'), []);
  });
});

describe('markdownLinks', () => {
  it('keeps relative links, drops anchors, queries and external targets', () => {
    const text =
      '[a](../flows/x.md) [b](y.md#bölüm) [c](https://example.com) [d](#yerel) [e](mailto:x@y.z) [f](z%20w.md "başlık") [g](q.md?v=1)';
    assert.deepEqual(markdownLinks(text), ['../flows/x.md', 'y.md', 'z w.md', 'q.md']);
  });
});

describe('backtickIdentifiers', () => {
  it('picks constant names and Nest class names only', () => {
    const line =
      '`PVP_DAILY_LIMIT` ve `ApplyReferralUseCase`, `GameLockGuard`, `DomainError` ama `login`, `LD`, `x-internal-api-key`, `500.000`, `Referral` değil';
    assert.deepEqual(backtickIdentifiers(line), ['PVP_DAILY_LIMIT', 'ApplyReferralUseCase', 'GameLockGuard', 'DomainError']);
  });
});

describe('STATUSES', () => {
  it('matches the values TEMPLATE-flow.md allows', () => {
    assert.equal(STATUSES.length, 6);
    assert.ok(STATUSES.includes("kod main'de, istemci bağlı değil"));
  });
});
