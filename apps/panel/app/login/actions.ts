'use server';

import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {createSession, passwordMatches, SESSION_COOKIE, SESSION_DAYS} from '@/lib/session';

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  if (!passwordMatches(String(form.get('password') ?? ''))) return 'Parola yanlış';
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSession(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.PANEL_INSECURE_COOKIE !== '1',
    maxAge: SESSION_DAYS * 86_400,
    path: '/',
  });
  const next = String(form.get('next') ?? '/');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
