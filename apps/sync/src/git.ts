import {exec} from './exec.ts';

export class GitError extends Error {
  readonly args: string[];
  readonly stderr: string;
  constructor(args: string[], stderr: string) {
    super(`git ${args.join(' ')} başarısız: ${stderr.trim()}`);
    this.args = args;
    this.stderr = stderr;
  }
}

export interface Merge {
  sha: string;
  subject: string;
  /** PR number parsed from "Merge pull request #561 …" or "title (#561)". */
  pr: number | null;
}

export class Git {
  readonly cwd: string;
  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async run(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const res = await exec('git', args, {
      cwd: this.cwd,
      env: env ? {...process.env, ...env} : undefined,
    });
    if (res.code !== 0) throw new GitError(args, res.stderr);
    return res.stdout;
  }

  /** Like run, but returns null instead of throwing (for "does this exist" questions). */
  async tryRun(args: string[]): Promise<string | null> {
    try {
      return await this.run(args);
    } catch (e) {
      if (e instanceof GitError) return null;
      throw e;
    }
  }

  async remoteHead(remote: string, branch: string): Promise<string> {
    const out = await this.run(['ls-remote', remote, `refs/heads/${branch}`]);
    const sha = out.split(/\s+/)[0];
    if (!sha) throw new Error(`${remote} üzerinde ${branch} dalı bulunamadı`);
    return sha;
  }

  async fetch(remote: string): Promise<void> {
    await this.run(['fetch', '--prune', '--quiet', remote]);
  }

  async revParse(rev: string): Promise<string> {
    return (await this.run(['rev-parse', '--verify', `${rev}^{commit}`])).trim();
  }

  async shortSha(rev: string, length = 8): Promise<string> {
    return (await this.run(['rev-parse', `--short=${length}`, rev])).trim();
  }

  async isAncestor(ancestor: string, rev: string): Promise<boolean> {
    return (await this.tryRun(['merge-base', '--is-ancestor', ancestor, rev])) !== null;
  }

  /** Merges on the first-parent line after base, oldest first — this is the queue. */
  async mergesAfter(base: string, head: string): Promise<Merge[]> {
    const out = await this.run([
      'log',
      '--first-parent',
      '--reverse',
      '--format=%H%x09%s',
      `${base}..${head}`,
    ]);
    return out
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const tab = line.indexOf('\t');
        const subject = line.slice(tab + 1);
        const m = /#(\d+)/.exec(subject);
        return {sha: line.slice(0, tab), subject, pr: m ? Number(m[1]) : null};
      });
  }

  async diffNameStatus(base: string, head: string): Promise<string> {
    return this.run(['diff', '--name-status', '-M', base, head]);
  }

  async show(rev: string, file: string): Promise<string | null> {
    return this.tryRun(['show', `${rev}:${file}`]);
  }

  async checkoutDetached(rev: string): Promise<void> {
    await this.run(['checkout', '--quiet', '--force', '--detach', rev]);
  }

  /** Throws away every local change and commit: the worker's clones are its own. */
  async resetHard(rev: string): Promise<void> {
    await this.run(['reset', '--quiet', '--hard', rev]);
    await this.run(['clean', '--quiet', '-fd']);
  }

  /** Paths (relative to the repo root) changed in the working tree, untracked files included. */
  async changedFiles(pathspec: string): Promise<string[]> {
    const out = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', pathspec]);
    const files: string[] = [];
    const entries = out.split('\0').filter(Boolean);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const status = entry.slice(0, 2);
      files.push(entry.slice(3));
      // Renames carry the old path as the next entry.
      if (status.startsWith('R')) i++;
    }
    return files;
  }

  async deletedFiles(pathspec: string): Promise<Set<string>> {
    const out = await this.run(['ls-files', '--deleted', '-z', '--', pathspec]);
    return new Set(out.split('\0').filter(Boolean));
  }

  async grepFixed(needle: string, rev: string): Promise<boolean> {
    return (await this.tryRun(['grep', '-q', '-F', '-e', needle, rev, '--'])) !== null;
  }

  async commitAll(message: string, author: {name: string; email: string}): Promise<void> {
    await this.run(['add', '--all']);
    await this.run(['commit', '--quiet', '--no-verify', '-m', message], {
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    });
  }

  async push(remote: string, branch: string): Promise<void> {
    await this.run(['push', '--quiet', remote, `HEAD:refs/heads/${branch}`]);
  }
}
