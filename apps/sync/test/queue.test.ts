import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {Merge} from '../src/git.ts';
import {describeMerges, nextJob} from '../src/queue.ts';

const m = (n: number): Merge => ({sha: `sha${n}`.padEnd(40, '0'), subject: `Merge pull request #${n}`, pr: n});

describe('nextJob', () => {
  it('returns null for an empty queue', () => {
    assert.equal(nextJob('base', [], 3), null);
  });

  it('takes only the oldest merge while the backlog is at or under the threshold', () => {
    const job = nextJob('base', [m(1), m(2), m(3)], 3);
    assert.deepEqual(job, {base: 'base', head: m(1).sha, merges: [m(1)]});
  });

  it('batches the whole backlog once it exceeds the threshold', () => {
    const queue = [m(1), m(2), m(3), m(4)];
    const job = nextJob('base', queue, 3);
    assert.equal(job?.head, m(4).sha);
    assert.deepEqual(job?.merges, queue);
  });
});

describe('describeMerges', () => {
  it('lists PR numbers and falls back to short shas', () => {
    assert.equal(describeMerges([m(561), {sha: 'abcdef1234', subject: 'hotfix', pr: null}]), '#561, abcdef12');
  });
});
