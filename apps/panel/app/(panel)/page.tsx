import {dailyTotals, overview} from '@ai-knowledge-engine/accounts';
import {readMeta} from '@ai-knowledge-engine/search';
import {PageTitle} from '@/components/ui';
import {services} from '@/lib/services';
import {OverviewView} from './overview-view';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const {db, redis, areas} = await services();
  const [o, days, backendMeta, frontendMeta] = await Promise.all([
    overview(db),
    dailyTotals(db, 30),
    readMeta(redis, areas.backend.spec),
    readMeta(redis, areas.frontend.spec),
  ]);
  return (
    <>
      <PageTitle>Genel bakış</PageTitle>
      {/* redis replies are null-prototype objects; pass a plain copy */}
      <OverviewView o={o} days={days} indexes={[{area: 'backend', ...backendMeta}, {area: 'frontend', ...frontendMeta}]} />
    </>
  );
}
