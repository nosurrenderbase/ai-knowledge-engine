/**
 * Who is using the panel, according to Cloudflare Access: the signed JWT
 * Cloudflare adds to every request (Cf-Access-Jwt-Assertion header or
 * CF_Authorization cookie), verified against the team's published keys,
 * audience and expiry. Without CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD nothing
 * verifies, and the settings stay read-only.
 */
import {createPublicKey, verify, type JsonWebKey} from 'node:crypto';
import {cookies, headers} from 'next/headers';

let certs: {at: number; keys: (JsonWebKey & {kid?: string})[]} | null = null;

async function keys(team: string): Promise<(JsonWebKey & {kid?: string})[]> {
  if (certs && Date.now() - certs.at < 3_600_000) return certs.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`, {signal: AbortSignal.timeout(5000)});
  if (!res.ok) throw new Error(`Access anahtarları alınamadı (${res.status})`);
  certs = {at: Date.now(), keys: ((await res.json()) as {keys: (JsonWebKey & {kid?: string})[]}).keys};
  return certs.keys;
}

const b64 = (s: string) => Buffer.from(s, 'base64url');

export function accessConfigured(env = process.env): boolean {
  return Boolean(env.CF_ACCESS_TEAM_DOMAIN?.trim() && env.CF_ACCESS_AUD?.trim());
}

/** The verified e-mail of the person behind this request, or null. */
export async function accessIdentity(env = process.env): Promise<string | null> {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const aud = env.CF_ACCESS_AUD?.trim();
  if (!team || !aud) return null;
  const token = (await headers()).get('cf-access-jwt-assertion') ?? (await cookies()).get('CF_Authorization')?.value;
  if (!token) return null;
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(b64(h).toString()) as {alg: string; kid?: string};
    const payload = JSON.parse(b64(p).toString()) as {aud: string | string[]; iss: string; exp: number; email?: string};
    if (header.alg !== 'RS256') return null;
    const jwk = (await keys(team)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({key: jwk, format: 'jwk'}), b64(sig));
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!ok || !auds.includes(aud) || payload.iss !== `https://${team}` || payload.exp * 1000 < Date.now()) return null;
    return payload.email ?? null;
  } catch {
    return null;
  }
}
