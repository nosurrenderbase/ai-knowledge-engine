import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Root of this monorepo. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * The worker's knowledge base clone, when present on this machine. Tests that
 * check the real documents are skipped without it.
 */
export const REAL_KB_AREA = path.join(REPO_ROOT, 'work/kb/backend');
export const HAS_REAL_KB = fs.existsSync(path.join(REAL_KB_AREA, 'flows'));

export function tmpDir(prefix = 'kb-test-'): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function write(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
}

export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** A git repo with the given files committed on main. */
export function initRepo(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(dir, {recursive: true});
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
  git('init', '--quiet', '--initial-branch=main');
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git('add', '--all');
  git('commit', '--quiet', '-m', 'ilk');
}
