import {dailyTotals, overview} from '@ai-knowledge-engine/accounts';
import {readMeta} from '@ai-knowledge-engine/search';
import {PageTitle} from '@/components/ui';
import {AREAS, services} from '@/lib/services';
import {readLive} from '@/lib/live';
import {readVersions} from '@/lib/versions';
import {OverviewView} from './overview-view';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const {db, redis, areas} = await services();
  const [o, days, metas, versions, live] = await Promise.all([
    overview(db),
    dailyTotals(db, 30),
    Promise.all(AREAS.map(area => readMeta(redis, areas[area].spec))),
    readVersions(),
    readLive(db),
  ]);
  return (
    <>
      <PageTitle>Genel bakış</PageTitle>
      {/* redis replies are null-prototype objects; pass a plain copy */}
      <OverviewView o={o} days={days} indexes={AREAS.map((area, i) => ({area, ...metas[i]}))} versions={versions} live={live} />
    </>
  );
}
