import {readGalaxy} from '@ai-knowledge-engine/search';
import {NextResponse} from 'next/server';
import {services} from '@/lib/services';

export const dynamic = 'force-dynamic';

/** The knowledge base map, compact: one row per chunk [area, x, y, z, path, title, section, module, kind]. */
export async function GET() {
  const {redis} = await services();
  const g = await readGalaxy(redis);
  if (!g) return NextResponse.json({status: 'pending'}, {status: 202});
  return NextResponse.json(
    {
      source: g.source,
      computedAt: g.computedAt,
      rows: g.points.map(p => [p.area, p.x, p.y, p.z, p.path, p.title, p.section, p.module, p.kind]),
    },
    {headers: {'cache-control': 'private, max-age=60'}},
  );
}
