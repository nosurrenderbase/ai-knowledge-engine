'use server';

import {addUser, issueToken, revokeToken, setDbAccess, setUserDisabled} from '@ai-knowledge-engine/accounts';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/auth';
import {services} from '@/lib/services';

export type Result = {ok: true; token?: string} | {ok: false; error: string};

async function run(fn: () => Promise<string | undefined>): Promise<Result> {
  await requireAdmin();
  try {
    const token = await fn();
    revalidatePath('/users');
    return {ok: true, token};
  } catch (e) {
    const msg = (e as Error).message;
    return {ok: false, error: /users_email_key/.test(msg) ? 'Bu e-posta zaten kayıtlı' : msg};
  }
}

export async function createUser(input: {name: string; email?: string; note?: string; label?: string}): Promise<Result> {
  return run(async () => {
    const {db} = await services();
    const name = input.name.trim();
    if (!name) throw new Error('Ad gerekli');
    const u = await addUser(db, {name, email: input.email?.trim() || undefined, note: input.note?.trim() || undefined});
    return (await issueToken(db, u.id, input.label?.trim() || undefined)).token;
  });
}

export async function createToken(userId: number, label?: string): Promise<Result> {
  return run(async () => (await issueToken((await services()).db, userId, label?.trim() || undefined)).token);
}

export async function revoke(prefix: string): Promise<Result> {
  return run(async () => {
    if (!(await revokeToken((await services()).db, prefix))) throw new Error('Aktif token bulunamadı');
    return undefined;
  });
}

export async function setDisabled(userId: number, disabled: boolean): Promise<Result> {
  return run(async () => {
    await setUserDisabled((await services()).db, userId, disabled);
    return undefined;
  });
}

/** Game database tools in the MCP (read-only, personal data excluded). */
export async function setDb(userId: number, allowed: boolean): Promise<Result> {
  return run(async () => {
    await setDbAccess((await services()).db, userId, allowed);
    return undefined;
  });
}
