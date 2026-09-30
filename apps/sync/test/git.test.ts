import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {Git, GitError} from '../src/git.ts';
import {git, initRepo, mergePr, tmpDir, write} from './helpers/repos.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

describe('Git', () => {
  let root: string;
  let repo: string;
  let base: string;

  before(() => {
    root = tmpDir();
    repo = path.join(root, 'repo');
    initRepo(repo, {'a.txt': 'a\n'});
    base = git(repo, 'rev-parse', 'HEAD');
  });
  after(() => fs.rmSync(root, {recursive: true, force: true}));

  it('lists merges on the first-parent line, oldest first, with PR numbers', async () => {
    const m1 = mergePr(repo, 561, {'b.txt': 'b\n'});
    const m2 = mergePr(repo, 562, {'c.txt': 'c\n'});
    git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'Squash başlığı (#563)');
    const direct = git(repo, 'rev-parse', 'HEAD');
    const merges = await new Git(repo).mergesAfter(base, 'HEAD');
    assert.deepEqual(
      merges.map(m => [m.sha, m.pr]),
      [
        [m1, 561],
        [m2, 562],
        [direct, 563],
      ],
    );
  });

  it('checks ancestry', async () => {
    const g = new Git(repo);
    assert.equal(await g.isAncestor(base, 'HEAD'), true);
    assert.equal(await g.isAncestor('HEAD', base), false);
  });

  it('reads the remote head with ls-remote', async () => {
    const clone = path.join(root, 'clone');
    git(root, 'clone', '--quiet', repo, clone);
    assert.equal(await new Git(clone).remoteHead('origin', 'main'), git(repo, 'rev-parse', 'HEAD'));
    await assert.rejects(new Git(clone).remoteHead('origin', 'yok'), /bulunamadı/);
  });

  it('reports changed files including untracked and renamed ones', async () => {
    const g = new Git(repo);
    write(repo, 'dir/new.md', 'yeni');
    write(repo, 'a.txt', 'değişti\n');
    git(repo, 'mv', 'b.txt', 'b2.txt');
    fs.rmSync(path.join(repo, 'c.txt'));
    assert.deepEqual((await g.changedFiles('.')).sort(), ['a.txt', 'b2.txt', 'c.txt', 'dir/new.md']);
    assert.deepEqual([...(await g.deletedFiles('.'))], ['c.txt']);
    await g.resetHard('HEAD');
    assert.deepEqual(await g.changedFiles('.'), []);
  });

  it('shows files at a revision and returns null when missing', async () => {
    const g = new Git(repo);
    assert.equal(await g.show(base, 'a.txt'), 'a\n');
    assert.equal(await g.show(base, 'yok.txt'), null);
  });

  it('commits with the given author and no trailers', async () => {
    const g = new Git(repo);
    write(repo, 'd.txt', 'd\n');
    await g.commitAll('backend: #1 senkronu', {name: 'kbsync', email: 'bot@example.invalid'});
    assert.equal(git(repo, 'log', '-1', '--format=%an <%ae>|%cn|%B'), 'kbsync <bot@example.invalid>|kbsync|backend: #1 senkronu');
  });

  it('wraps failures in GitError', async () => {
    await assert.rejects(new Git(repo).run(['rev-parse', 'olmayan-ref']), GitError);
  });
});
