import {listUsers, recentQueries} from '@ai-knowledge-engine/accounts';
import {DAY_OPTIONS, Filters, TOOL_OPTIONS} from '@/components/filters';
import {PageTitle} from '@/components/ui';
import {services} from '@/lib/services';
import {QueriesTable, type QueryView} from './queries-table';

export const dynamic = 'force-dynamic';

export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{days?: string; user?: string; tool?: string; empty?: string}>;
}) {
  const sp = await searchParams;
  const {db} = await services();
  const [rows, users] = await Promise.all([
    recentQueries(db, {
      days: Number(sp.days ?? 7),
      userId: sp.user ? Number(sp.user) : undefined,
      tool: sp.tool,
      emptyOnly: sp.empty === '1',
      limit: 500,
    }),
    listUsers(db),
  ]);
  const view: QueryView[] = rows.map((r, i) => ({
    key: i,
    at: r.at.toISOString(),
    name: r.name,
    tool: r.tool,
    asked: String(r.input.query ?? r.input.path ?? r.input.pattern ?? r.input.prefix ?? ''),
    filters: Object.entries(r.input)
      .filter(([k, v]) => !['query', 'path', 'pattern'].includes(k) && v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${v}`)
      .join(' '),
    count: r.result.count === undefined ? null : Number(r.result.count),
    paths: Array.isArray(r.result.paths) ? (r.result.paths as string[]) : [],
    durationMs: r.durationMs,
    error: r.error,
  }));
  return (
    <>
      <PageTitle>Sorular</PageTitle>
      <Filters
        defs={[
          {name: 'days', label: 'Son 7 gün', options: DAY_OPTIONS},
          {name: 'user', label: 'Tüm kullanıcılar', options: users.map(u => ({value: String(u.id), label: u.name})), width: 220},
          {name: 'tool', label: 'Tüm araçlar', options: TOOL_OPTIONS},
          {name: 'empty', label: 'Yalnız sonuçsuzlar', checkbox: true},
        ]}
      />
      <QueriesTable rows={view} />
    </>
  );
}
