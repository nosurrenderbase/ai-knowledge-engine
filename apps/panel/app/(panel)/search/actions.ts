'use server';

import {docKey, search, type SearchHit} from '@ai-knowledge-engine/search';
import {requireAdmin} from '@/lib/auth';
import {services} from '@/lib/services';

export async function runSearch(input: {
  query: string;
  module?: string;
  kind?: string;
  includeRemoved?: boolean;
  limit?: number;
}): Promise<{ok: true; hits: SearchHit[]; ms: number} | {ok: false; error: string}> {
  await requireAdmin();
  try {
    const started = performance.now();
    const hits = await search((await services()).search, input.query, {
      limit: input.limit ?? 10,
      filters: {module: input.module || undefined, kind: input.kind || undefined, includeRemoved: input.includeRemoved},
    });
    return {ok: true, hits, ms: Math.round(performance.now() - started)};
  } catch (e) {
    return {ok: false, error: (e as Error).message};
  }
}

export async function readDoc(path: string): Promise<string | null> {
  await requireAdmin();
  const {redis, cfg} = await services();
  return (await redis.hGet(docKey(cfg.target, path), 'text')) ?? null;
}
