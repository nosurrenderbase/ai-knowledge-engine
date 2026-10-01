/**
 * The overview's live feed: the latest MCP calls in one line each, and
 * today's call count. Polled by the page every few seconds.
 */
import {overview, recentQueries, type QueryRow} from '@ai-knowledge-engine/accounts';
import type {Db} from '@ai-knowledge-engine/accounts';

export interface LiveEvent {
  id: string;
  at: string;
  name: string;
  tool: string;
  /** What was asked, as the person typed it (query, path, pattern, team…). */
  text: string;
  count: number | null;
  ms: number;
  error: boolean;
}

export interface LiveState {
  callsToday: number;
  events: LiveEvent[];
}

const FIELDS = ['query', 'path', 'pattern', 'prefix', 'team_id', 'match_id', 'id', 'collection'];

export function describeInput(input: Record<string, unknown>): string {
  for (const f of FIELDS) {
    const v = input[f];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 140);
  }
  return '';
}

const toEvent = (r: QueryRow): LiveEvent => ({
  id: `${new Date(r.at).toISOString()}|${r.tool}|${r.name ?? ''}`,
  at: new Date(r.at).toISOString(),
  name: r.name ?? 'silinmiş kullanıcı',
  tool: r.tool,
  text: describeInput(r.input),
  count: typeof r.result?.count === 'number' ? (r.result.count as number) : null,
  ms: r.durationMs,
  error: Boolean(r.error),
});

export async function readLive(db: Db, limit = 8): Promise<LiveState> {
  const [o, rows] = await Promise.all([overview(db), recentQueries(db, {days: 7, limit})]);
  return {callsToday: o.callsToday, events: rows.map(toEvent)};
}
