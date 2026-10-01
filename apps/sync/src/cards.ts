import * as fs from 'node:fs';
import * as path from 'node:path';
import {genBlock, listMarkdown} from '@ai-knowledge-engine/kb';
import type {Git} from './git.ts';

const withoutCommitLine = (text: string) => text.replace(/^code_commit: .*$/m, '');

/**
 * Generators stamp `code_commit` on every document they write. Generated
 * documents whose only change is that stamp are restored, so a commit shows
 * only documents whose content really changed. Returns those (repo-relative).
 */
export async function dropStampOnlyChanges(git: Git, area: string): Promise<string[]> {
  const changed: string[] = [];
  for (const file of await git.changedFiles(area)) {
    const abs = path.join(git.cwd, file);
    if (!file.endsWith('.md') || !fs.existsSync(abs)) continue;
    const now = fs.readFileSync(abs, 'utf8');
    if (genBlock(now) === null) continue;
    const before = await git.show('HEAD', file);
    if (before !== null && withoutCommitLine(before) === withoutCommitLine(now)) {
      await git.run(['checkout', 'HEAD', '--', file]);
    } else {
      changed.push(file);
    }
  }
  return changed;
}

/** Generated blocks of every generated document in the area, keyed by repo-relative path. */
export function snapshotGenBlocks(repoRoot: string, area: string): Map<string, string | null> {
  const blocks = new Map<string, string | null>();
  const areaDir = path.join(repoRoot, area);
  for (const rel of listMarkdown(areaDir)) {
    const block = genBlock(fs.readFileSync(path.join(areaDir, rel), 'utf8'));
    if (block !== null) blocks.set(`${area}/${rel}`, block);
  }
  return blocks;
}
