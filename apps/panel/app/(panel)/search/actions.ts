'use server';

import {docKey, search, type SearchHit} from '@ai-knowledge-engine/search';
import {requireAdmin} from '@/lib/auth';
import {AREAS, services, type AreaName} from '@/lib/services';

export type AreaHit = SearchHit & {area: AreaName};

export async function runSearch(input: {
  query: string;
  area?: AreaName;
  module?: string;
  kind?: string;
  includeRemoved?: boolean;
  limit?: number;
}): Promise<{ok: true; hits: AreaHit[]; ms: number} | {ok: false; error: string}> {
  await requireAdmin();
  try {
    const started = performance.now();
    const {areas} = await services();
    const limit = input.limit ?? 10;
    const hits: AreaHit[] = [];
    for (const area of input.area ? [input.area] : AREAS) {
      try {
        const found = await search(areas[area], input.query, {
          limit,
          filters: {module: input.module || undefined, kind: input.kind || undefined, includeRemoved: input.includeRemoved},
        });
        hits.push(...found.map(h => ({...h, area})));
      } catch {
        // an area without an index yet
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return {ok: true, hits: hits.slice(0, limit), ms: Math.round(performance.now() - started)};
  } catch (e) {
    return {ok: false, error: (e as Error).message};
  }
}

export async function readDoc(area: AreaName, path: string): Promise<string | null> {
  await requireAdmin();
  const {redis, areas} = await services();
  return (await redis.hGet(docKey(areas[area].spec, path), 'text')) ?? null;
}
