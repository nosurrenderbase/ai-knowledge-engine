'use server';

import * as fs from 'node:fs';
import {requestChange} from '@ai-knowledge-engine/accounts';
import {displayValue, seal, settingByKey, validateChange, type Target} from '@ai-knowledge-engine/settings';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/auth';
import {accessIdentity} from '@/lib/cfaccess';
import {services} from '@/lib/services';

export type Result = {ok: true} | {ok: false; error: string};

/** Writes need the panel session AND a verified Cloudflare Access identity (recorded with the change). */
async function writer(): Promise<string> {
  const who = await accessIdentity();
  if (!who) throw new Error('Ayar değiştirmek için Cloudflare Access ile giriş gerekli');
  return who;
}

export async function changeSetting(key: string, value: string | null): Promise<Result> {
  await requireAdmin();
  try {
    const who = await writer();
    const v = value === null ? null : value.trim();
    const invalid = validateChange(key, v);
    if (invalid) return {ok: false, error: invalid};
    const def = settingByKey(key)!;
    const {db} = await services();
    if (v === null || v === '') {
      await requestChange(db, {requestedBy: who, kind: 'unset', key});
    } else {
      const pub = fs.readFileSync(process.env.SETTINGS_PUBLIC_KEY ?? '/data/settings/key.pub', 'utf8');
      await requestChange(db, {requestedBy: who, kind: 'set', key, sealedValue: seal(v, pub), valueHint: displayValue(def, v) ?? undefined});
    }
    revalidatePath('/system');
    return {ok: true};
  } catch (e) {
    return {ok: false, error: (e as Error).message};
  }
}

export async function restartService(target: Target): Promise<Result> {
  await requireAdmin();
  try {
    const who = await writer();
    if (!['mcp', 'panel', 'worker', 'cloudflared'].includes(target)) return {ok: false, error: 'bilinmeyen servis'};
    await requestChange((await services()).db, {requestedBy: who, kind: 'restart', target});
    revalidatePath('/system');
    return {ok: true};
  } catch (e) {
    return {ok: false, error: (e as Error).message};
  }
}
