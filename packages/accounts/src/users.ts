import {createHash, randomBytes} from 'node:crypto';
import type {Db} from './db.ts';

export interface User {
  id: number;
  name: string;
  email: string | null;
  note: string | null;
  createdAt: Date;
  disabledAt: Date | null;
  /** May query the game database (MCP db_* tools). */
  dbAccess: boolean;
}

export interface Principal {
  userId: number;
  tokenId: number;
  name: string;
  dbAccess?: boolean;
}

export interface IssuedToken {
  tokenId: number;
  prefix: string;
  /** Shown once; only its hash is stored. */
  token: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** "kb_<8 hex>_<43 chars>": the prefix identifies a token in lists without revealing it. */
export function newToken(): {prefix: string; token: string} {
  const prefix = randomBytes(4).toString('hex');
  return {prefix, token: `kb_${prefix}_${randomBytes(32).toString('base64url')}`};
}

const toUser = (r: Record<string, unknown>): User => ({
  id: Number(r.id),
  name: r.name as string,
  email: (r.email as string) ?? null,
  note: (r.note as string) ?? null,
  createdAt: r.created_at as Date,
  disabledAt: (r.disabled_at as Date) ?? null,
  dbAccess: Boolean(r.db_access),
});

export async function addUser(db: Db, u: {name: string; email?: string; note?: string}): Promise<User> {
  const {rows} = await db.query('insert into users (name, email, note) values ($1, $2, $3) returning *', [u.name, u.email ?? null, u.note ?? null]);
  return toUser(rows[0]);
}

/** Finds a user by id or e-mail. */
export async function findUser(db: Db, ref: string): Promise<User | null> {
  const byId = /^\d+$/.test(ref);
  const {rows} = await db.query(`select * from users where ${byId ? 'id = $1' : 'lower(email) = lower($1)'}`, [byId ? Number(ref) : ref]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function setUserDisabled(db: Db, userId: number, disabled: boolean): Promise<void> {
  await db.query('update users set disabled_at = $2 where id = $1', [userId, disabled ? new Date() : null]);
}

export async function setDbAccess(db: Db, userId: number, allowed: boolean): Promise<void> {
  await db.query('update users set db_access = $2 where id = $1', [userId, allowed]);
}

export async function issueToken(db: Db, userId: number, label?: string): Promise<IssuedToken> {
  const {prefix, token} = newToken();
  const {rows} = await db.query('insert into tokens (user_id, prefix, hash, label) values ($1, $2, $3, $4) returning id', [
    userId,
    prefix,
    hashToken(token),
    label ?? null,
  ]);
  return {tokenId: Number(rows[0].id), prefix, token};
}

/** Revokes by token prefix (as shown in lists). Returns false when nothing matched. */
export async function revokeToken(db: Db, prefix: string): Promise<boolean> {
  const res = await db.query('update tokens set revoked_at = now() where prefix = $1 and revoked_at is null', [prefix.replace(/^kb_/, '')]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Checks a presented token. Revoked tokens and disabled users do not pass.
 * last_used_at is refreshed at most once a minute.
 */
export async function verifyToken(db: Db, token: string): Promise<Principal | null> {
  if (!/^kb_[0-9a-f]{8}_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const {rows} = await db.query(
    `select t.id as token_id, u.id as user_id, u.name, u.db_access
       from tokens t join users u on u.id = t.user_id
      where t.hash = $1 and t.revoked_at is null and u.disabled_at is null`,
    [hashToken(token)],
  );
  if (!rows[0]) return null;
  const principal = {userId: Number(rows[0].user_id), tokenId: Number(rows[0].token_id), name: rows[0].name as string, dbAccess: Boolean(rows[0].db_access)};
  await db.query(`update tokens set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`, [
    principal.tokenId,
  ]);
  return principal;
}

export interface UserRow extends User {
  activeTokens: number;
  lastUsedAt: Date | null;
  calls30d: number;
}

export async function listUsers(db: Db): Promise<UserRow[]> {
  const {rows} = await db.query(
    `select u.*,
            (select count(*) from tokens t where t.user_id = u.id and t.revoked_at is null) as active_tokens,
            (select max(last_used_at) from tokens t where t.user_id = u.id) as last_used_at,
            coalesce((select sum(calls) from usage_daily d where d.user_id = u.id and d.day > current_date - 30), 0) as calls_30d
       from users u order by u.id`,
  );
  return rows.map(r => ({...toUser(r), activeTokens: Number(r.active_tokens), lastUsedAt: r.last_used_at ?? null, calls30d: Number(r.calls_30d)}));
}

export interface TokenRow {
  prefix: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export async function listTokens(db: Db, userId: number): Promise<TokenRow[]> {
  const {rows} = await db.query('select * from tokens where user_id = $1 order by id', [userId]);
  return rows.map(r => ({prefix: r.prefix, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at}));
}
