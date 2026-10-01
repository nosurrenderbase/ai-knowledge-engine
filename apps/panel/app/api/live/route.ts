import {NextResponse} from 'next/server';
import {readLive} from '@/lib/live';
import {services} from '@/lib/services';

export const dynamic = 'force-dynamic';

/** Latest MCP calls and today's count (behind the panel login, like every page). */
export async function GET() {
  const {db} = await services();
  return NextResponse.json(await readLive(db), {headers: {'cache-control': 'no-store'}});
}
