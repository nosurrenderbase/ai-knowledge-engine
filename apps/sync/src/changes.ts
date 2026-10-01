export type ChangeStatus = 'A' | 'M' | 'D' | 'R';

export interface Change {
  status: ChangeStatus;
  path: string;
  /** Previous path of a rename. */
  oldPath?: string;
}

/** Parses `git diff --name-status -M` output. Copies count as additions, type changes as modifications. */
export function parseNameStatus(text: string): Change[] {
  const changes: Change[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const code = cols[0][0];
    if (code === 'R') {
      changes.push({status: 'R', oldPath: cols[1], path: cols[2]});
    } else if (code === 'C') {
      changes.push({status: 'A', path: cols[2]});
    } else if (code === 'A' || code === 'D') {
      changes.push({status: code, path: cols[1]});
    } else {
      changes.push({status: 'M', path: cols[1]});
    }
  }
  return changes;
}

const LOCK_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json', 'go.sum']);

/**
 * Files that cannot change documented behaviour: tests, the code repo's own
 * markdown, lock files, images and CI configuration outside `.github/`.
 */
export function isIrrelevant(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (/\.(spec|test)\.ts$/.test(name) || name.endsWith('_test.go')) return true;
  if (/\.(png|jpe?g|gif|svg|ico)$/i.test(name)) return true;
  if (path.startsWith('test/') || path.includes('/test/') || path.includes('/__tests__/')) return true;
  if (name.toLowerCase().endsWith('.md')) return true;
  if (LOCK_FILES.has(name)) return true;
  if (/^(\.gitlab-ci\.yml|\.circleci\/|\.husky\/|\.travis\.yml|azure-pipelines\.yml|bitbucket-pipelines\.yml)/.test(path)) {
    return true;
  }
  return false;
}

export function relevantChanges(changes: Change[]): Change[] {
  return changes.filter(c => !(isIrrelevant(c.path) && (!c.oldPath || isIrrelevant(c.oldPath))));
}
