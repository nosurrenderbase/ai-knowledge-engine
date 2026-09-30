import {dailyTotals, listUsers, usageSummary} from '@ai-knowledge-engine/accounts';
import {DAY_OPTIONS, Filters} from '@/components/filters';
import {PageTitle} from '@/components/ui';
import {services} from '@/lib/services';
import {UsageView, type UsageRow} from './usage-view';

export const dynamic = 'force-dynamic';

export default async function UsagePage({searchParams}: {searchParams: Promise<{days?: string; user?: string}>}) {
  const sp = await searchParams;
  const days = Number(sp.days ?? 30);
  const userId = sp.user ? Number(sp.user) : undefined;
  const {db} = await services();
  const [summary, daily, users] = await Promise.all([usageSummary(db, days), dailyTotals(db, days, userId), listUsers(db)]);

  const byUser = new Map<number, UsageRow>();
  for (const r of summary) {
    if (userId && r.userId !== userId) continue;
    const row = byUser.get(r.userId) ?? {key: r.userId, name: r.name, total: 0, errors: 0, tools: {}};
    row.tools[r.tool] = r.calls;
    row.total += r.calls;
    row.errors += r.errors;
    byUser.set(r.userId, row);
  }

  return (
    <>
      <PageTitle>Kullanım</PageTitle>
      <Filters
        defs={[
          {name: 'days', label: 'Son 30 gün', options: DAY_OPTIONS},
          {name: 'user', label: 'Tüm kullanıcılar', options: users.map(u => ({value: String(u.id), label: u.name})), width: 220},
        ]}
      />
      <UsageView days={days} daily={daily} rows={[...byUser.values()].sort((a, b) => b.total - a.total)} />
    </>
  );
}
