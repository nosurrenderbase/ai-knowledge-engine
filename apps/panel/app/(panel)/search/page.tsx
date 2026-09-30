import {Hint, PageTitle} from '@/components/ui';
import {SearchConsole} from './search-console';

export default function SearchPage() {
  return (
    <>
      <PageTitle>Arama denemesi</PageTitle>
      <Hint>
        MCP'nin search aracının aynısı (voyage-4-large + Türkçe kelime araması). Bir sonuca tıklayınca doküman açılır. Buradan yapılan aramalar kullanım kaydına girmez.
      </Hint>
      <SearchConsole />
    </>
  );
}
