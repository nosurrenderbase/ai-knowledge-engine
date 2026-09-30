import type {Db} from './db.ts';

export interface UsageEvent {
  userId: number | null;
  tokenId: number | null;
  tool: string;
  /** What was asked: query, path, pattern, filters. */
  input: Record<string, unknown>;
  /** What came back: counts, top document paths. */
  result: Record<string, unknown>;
  durationMs: number;
  error?: string | null;
  client?: string | null;
  at?: Date;
}

/** Records a call and bumps the person's daily total in one statement. */
export async function recordUsage(db: Db, e: UsageEvent): Promise<void> {
  await db.query(
    `with e as (
       insert into usage_events (at, user_id, token_id, tool, input, result, duration_ms, error, client)
       values (coalesce($1, now()), $2, $3, $4, $5, $6, $7, $8, $9)
       returning at, user_id, tool, (error is not null)::int as failed
     )
     insert into usage_daily (day, user_id, tool, calls, errors)
     select (at at time zone 'Europe/Istanbul')::date, user_id, tool, 1, failed from e where user_id is not null
     on conflict (day, user_id, tool) do update
       set calls = usage_daily.calls + 1, errors = usage_daily.errors + excluded.errors`,
    [e.at ?? null, e.userId, e.tokenId, e.tool, JSON.stringify(e.input), JSON.stringify(e.result), Math.round(e.durationMs), e.error ?? null, e.client ?? null],
  );
}

/** Deletes call details older than `days`; daily totals stay. Returns how many rows went. */
export async function purgeUsage(db: Db, days: number): Promise<number> {
  const res = await db.query('delete from usage_events where at < now() - make_interval(days => $1)', [days]);
  return res.rowCount ?? 0;
}

export interface UsageSummaryRow {
  userId: number;
  name: string;
  tool: string;
  calls: number;
  errors: number;
}

export async function usageSummary(db: Db, days: number): Promise<UsageSummaryRow[]> {
  const {rows} = await db.query(
    `select d.user_id, u.name, d.tool, sum(d.calls) as calls, sum(d.errors) as errors
       from usage_daily d join users u on u.id = d.user_id
      where d.day > (now() at time zone 'Europe/Istanbul')::date - $1::int
      group by d.user_id, u.name, d.tool
      order by u.name, d.tool`,
    [days],
  );
  return rows.map(r => ({userId: Number(r.user_id), name: r.name, tool: r.tool, calls: Number(r.calls), errors: Number(r.errors)}));
}

export interface QueryRow {
  at: Date;
  name: string | null;
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  durationMs: number;
  error: string | null;
}

/** Recent calls, newest first; `emptyOnly` keeps searches that found nothing. */
export async function recentQueries(
  db: Db,
  opts: {days?: number; userId?: number; tool?: string; emptyOnly?: boolean; limit?: number} = {},
): Promise<QueryRow[]> {
  const where = ['e.at > now() - make_interval(days => $1)'];
  const params: unknown[] = [opts.days ?? 7];
  if (opts.userId !== undefined) where.push(`e.user_id = $${params.push(opts.userId)}`);
  if (opts.tool) where.push(`e.tool = $${params.push(opts.tool)}`);
  if (opts.emptyOnly) where.push(`coalesce((e.result->>'count')::int, 0) = 0`);
  params.push(opts.limit ?? 50);
  const {rows} = await db.query(
    `select e.at, u.name, e.tool, e.input, e.result, e.duration_ms, e.error
       from usage_events e left join users u on u.id = e.user_id
      where ${where.join(' and ')}
      order by e.at desc limit $${params.length}`,
    params,
  );
  return rows.map(r => ({at: r.at, name: r.name, tool: r.tool, input: r.input, result: r.result, durationMs: r.duration_ms, error: r.error}));
}
