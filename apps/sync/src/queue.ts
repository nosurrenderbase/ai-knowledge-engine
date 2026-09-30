import type {Merge} from './git.ts';

export interface Job {
  /** Watermark: the code commit the knowledge base was last synced to. */
  base: string;
  /** The merge this job syncs to; becomes the new watermark on success. */
  head: string;
  /** Merges covered by this job, oldest first. */
  merges: Merge[];
}

/**
 * Picks the next job from the queue. Normally one merge at a time (FIFO); when
 * more than `batchThreshold` merges are waiting, the whole backlog becomes one
 * job so a burst of merges does not turn into a burst of runs.
 */
export function nextJob(base: string, queue: Merge[], batchThreshold: number): Job | null {
  if (queue.length === 0) return null;
  const merges = queue.length > batchThreshold ? queue : queue.slice(0, 1);
  return {base, head: merges[merges.length - 1].sha, merges};
}

export function describeMerges(merges: Merge[]): string {
  const prs = merges.map(m => (m.pr === null ? m.sha.slice(0, 8) : `#${m.pr}`));
  return prs.join(', ');
}
