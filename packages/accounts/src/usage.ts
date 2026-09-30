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

export interface DailyTotal {
  /** YYYY-MM-DD (Europe/Istanbul). */
  day: string;
  calls: number;
  errors: number;
}

/** Calls per day for the last `days` days, every day present (zero when quiet). */
export async function dailyTotals(db: Db, days: number, userId?: number): Promise<DailyTotal[]> {
  const {rows} = await db.query(
    `with days as (
       select generate_series((now() at time zone 'Europe/Istanbul')::date - ($1::int - 1), (now() at time zone 'Europe/Istanbul')::date, interval '1 day')::date as day
     )
     select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(sum(d.calls), 0) as calls, coalesce(sum(d.errors), 0) as errors
       from days left join usage_daily d on d.day = days.day and ($2::bigint is null or d.user_id = $2)
      group by days.day order by days.day`,
    [days, userId ?? null],
  );
  return rows.map(r => ({day: r.day, calls: Number(r.calls), errors: Number(r.errors)}));
}

export interface Overview {
  users: number;
  activeUsers7d: number;
  callsToday: number;
  calls7d: number;
  calls30d: number;
  emptySearches7d: number;
}

export async function overview(db: Db): Promise<Overview> {
  const {rows} = await db.query(
    `with today as (select (now() at time zone 'Europe/Istanbul')::date as d)
     select
       (select count(*) from users where disabled_at is null) as users,
       (select count(distinct user_id) from usage_daily, today where day > today.d - 7) as active_users_7d,
       (select coalesce(sum(calls), 0) from usage_daily, today where day = today.d) as calls_today,
       (select coalesce(sum(calls), 0) from usage_daily, today where day > today.d - 7) as calls_7d,
       (select coalesce(sum(calls), 0) from usage_daily, today where day > today.d - 30) as calls_30d,
       (select count(*) from usage_events where tool = 'search' and at > now() - interval '7 days'
          and coalesce((result->>'count')::int, 0) = 0) as empty_searches_7d`,
  );
  const r = rows[0];
  return {
    users: Number(r.users),
    activeUsers7d: Number(r.active_users_7d),
    callsToday: Number(r.calls_today),
    calls7d: Number(r.calls_7d),
    calls30d: Number(r.calls_30d),
    emptySearches7d: Number(r.empty_searches_7d),
  };
}
