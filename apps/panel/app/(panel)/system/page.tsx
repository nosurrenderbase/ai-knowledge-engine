import {PageTitle} from '@/components/ui';
import {readSettings} from '@/lib/settings-view';
import {readSystem} from '@/lib/system';
import {SystemView} from './system-view';

export const dynamic = 'force-dynamic';

export default async function SystemPage({searchParams}: {searchParams: Promise<{tab?: string}>}) {
  const {tab} = await searchParams;
  const [system, settings] = await Promise.all([readSystem(), readSettings()]);
  return (
    <>
      <PageTitle>Sistem</PageTitle>
      <SystemView tab={tab === 'ayarlar' ? 'ayarlar' : 'durum'} system={system} settings={settings} />
    </>
  );
}
