import {NextResponse, type NextRequest} from 'next/server';
import {SESSION_COOKIE, validSession} from './lib/session';

/** Every page but the login needs a valid admin session. */
export function proxy(request: NextRequest) {
  if (validSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL('/login', request.url);
  url.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Icons and the manifest load before login too (the login tab shows the shield).
  matcher: ['/((?!login|api/health|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|brand.png|maskable-512.png).*)'],
};
