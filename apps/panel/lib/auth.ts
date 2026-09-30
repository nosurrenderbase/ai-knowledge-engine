import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {SESSION_COOKIE, validSession} from './session';

/** The proxy only guards navigation; every server action checks again. */
export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  if (!validSession(jar.get(SESSION_COOKIE)?.value)) redirect('/login');
}
