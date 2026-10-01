/**
 * The settings page's data: every catalogued key with what may be shown of
 * its value (secrets: only the last 4 characters), recent changes (the audit
 * log), and whether this request may write (verified Cloudflare Access identity).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {recentChanges} from '@ai-knowledge-engine/accounts';
import {displayValue, parseEnv, SETTINGS, type EnvFile, type Target} from '@ai-knowledge-engine/settings';
import {accessConfigured, accessIdentity} from './cfaccess';
import {services} from './services';

export interface SettingRow {
  key: string;
  group: string;
  about: string;
  secret: boolean;
  readOnly: boolean;
  required: boolean;
  restart: Target[];
  value: string | null;
  /** Used by the code when the key is not set. */
  fallback: string | null;
  pending: boolean;
}

export interface ChangeRow {
  id: number;
  at: string;
  by: string;
  what: string;
  hint: string | null;
  status: string;
  error: string | null;
}

export interface SettingsView {
  rows: SettingRow[];
  changes: ChangeRow[];
  identity: string | null;
  accessConfigured: boolean;
  keyReady: boolean;
}

const ENV_FILE: Record<EnvFile, string> = {env: '.env', kbsync: 'kbsync.env'};

export async function readSettings(env = process.env): Promise<SettingsView> {
  const {db} = await services();
  const values: Record<EnvFile, Record<string, string>> = {env: {}, kbsync: {}};
  for (const f of ['env', 'kbsync'] as EnvFile[]) {
    try {
      values[f] = parseEnv(fs.readFileSync(path.join(env.ENV_DIR ?? '/data/env', ENV_FILE[f]), 'utf8'));
    } catch {
      // not mounted (local dev): values show as unset
    }
  }
  const changes = await recentChanges(db, 40);
  const pendingKeys = new Set(changes.filter(c => c.status === 'pending' && c.key).map(c => c.key));
  return {
    rows: SETTINGS.map(s => ({
      key: s.key,
      group: s.group,
      about: s.about,
      secret: s.secret,
      readOnly: Boolean(s.readOnly),
      required: Boolean(s.required),
      restart: s.restart,
      value: displayValue(s, values[s.file][s.key]),
      fallback: s.fallback ?? null,
      pending: pendingKeys.has(s.key),
    })),
    changes: changes.map(c => ({
      id: c.id,
      at: new Date(c.createdAt).toISOString(),
      by: c.requestedBy,
      what: c.kind === 'restart' ? `${c.target} yeniden başlatma` : c.kind === 'unset' ? `${c.key} silindi` : `${c.key} değiştirildi`,
      hint: c.valueHint,
      status: c.status,
      error: c.error,
    })),
    identity: await accessIdentity(env),
    accessConfigured: accessConfigured(env),
    keyReady: Boolean(env.SETTINGS_PUBLIC_KEY && fs.existsSync(env.SETTINGS_PUBLIC_KEY)),
  };
}
