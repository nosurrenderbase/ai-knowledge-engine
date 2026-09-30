import * as fs from 'node:fs';
import * as path from 'node:path';
import {genBlock} from '@ai-knowledge-engine/kb';
import type {Git} from './git.ts';

const withoutCommitLine = (text: string) => text.replace(/^code_commit: .*$/m, '');

/**
 * The generator stamps `code_commit` on every card of a module it touches.
 * Cards whose only change is that stamp are restored, so a commit shows only
 * cards whose content really changed. Returns the cards that did change.
 */
export async function dropStampOnlyChanges(git: Git, area: string): Promise<string[]> {
  const changed: string[] = [];
  for (const file of await git.changedFiles(`${area}/usecases`)) {
    const abs = path.join(git.cwd, file);
    if (!fs.existsSync(abs)) continue;
    const before = await git.show('HEAD', file);
    if (before !== null && withoutCommitLine(before) === withoutCommitLine(fs.readFileSync(abs, 'utf8'))) {
      await git.run(['checkout', 'HEAD', '--', file]);
    } else {
      changed.push(file);
    }
  }
  return changed;
}

/** Generated blocks of every card in the area, keyed by path relative to the repo root. */
export function snapshotGenBlocks(repoRoot: string, area: string): Map<string, string | null> {
  const blocks = new Map<string, string | null>();
  const dir = path.join(repoRoot, area, 'usecases');
  if (!fs.existsSync(dir)) return blocks;
  for (const module of fs.readdirSync(dir)) {
    const moduleDir = path.join(dir, module);
    if (!fs.statSync(moduleDir).isDirectory()) continue;
    for (const name of fs.readdirSync(moduleDir)) {
      if (!name.endsWith('.md')) continue;
      const rel = `${area}/usecases/${module}/${name}`;
      blocks.set(rel, genBlock(fs.readFileSync(path.join(moduleDir, name), 'utf8')));
    }
  }
  return blocks;
}
