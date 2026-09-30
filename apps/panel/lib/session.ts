/**
 * Admin session: one shared panel password (PANEL_PASSWORD) and a signed,
 * expiring cookie (HMAC with PANEL_SECRET). No user table for admins yet.
 */
import {createHmac, timingSafeEqual} from 'node:crypto';

export const SESSION_COOKIE = 'kb_panel';
export const SESSION_DAYS = 7;

function secret(): string {
  const s = process.env.PANEL_SECRET;
  if (!s || s.length < 32) throw new Error('PANEL_SECRET tanımlı değil (en az 32 karakter)');
  return s;
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function createSession(now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${sign(exp)}`;
}

export function validSession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function passwordMatches(given: string): boolean {
  const want = process.env.PANEL_PASSWORD;
  if (!want) return false;
  const a = createHmac('sha256', 'cmp').update(given).digest();
  const b = createHmac('sha256', 'cmp').update(want).digest();
  return timingSafeEqual(a, b);
}
