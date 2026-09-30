import {dailyTotals, overview} from '@ai-knowledge-engine/accounts';
import {readMeta} from '@ai-knowledge-engine/search';
import {PageTitle} from '@/components/ui';
import {services} from '@/lib/services';
import {OverviewView} from './overview-view';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const {db, redis, cfg} = await services();
  const [o, days, meta] = await Promise.all([overview(db), dailyTotals(db, 30), readMeta(redis, cfg.target)]);
  return (
    <>
      <PageTitle>Genel bakış</PageTitle>
      {/* redis replies are null-prototype objects; pass a plain copy */}
      <OverviewView o={o} days={days} meta={{...meta}} />
    </>
  );
}
