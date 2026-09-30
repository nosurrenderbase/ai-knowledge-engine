import * as path from 'node:path';
import type {ClaudeConfig} from './claude.ts';

export interface Config {
  /** Worker's own clone of the knowledge base repo. */
  kbRepo: string;
  kbRemote: string;
  kbBranch: string;
  /** Worker's own clone of the code repo; it is checked out detached at each job's head. */
  codeRepo: string;
  codeRemote: string;
  codeBranch: string;
  /** Knowledge base folder this worker keeps in sync ("backend"). */
  area: string;
  pollIntervalMs: number;
  batchThreshold: number;
  maxAttempts: number;
  validationRounds: number;
  /** Larger impact lists are split into several Claude calls of about this many documents. */
  groupMaxDocs: number;
  /** Wait after a usage limit when the reset time cannot be read from the message. */
  limitBackoffMs: number;
  /** Folder with one sub-folder of prompts per area (prompts/backend/UPDATE-PROMPT.md). */
  promptsDir: string;
  claude: ClaudeConfig;
  author: {name: string; email: string};
  alertWebhookUrl: string | undefined;
  /** Commit locally but never push (backtests). */
  dryRun: boolean;
}

/** The repo's own prompts folder (apps/sync/src → prompts). */
const DEFAULT_PROMPTS_DIR = path.resolve(import.meta.dirname, '../../../prompts');

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`${key} tanımlı değil`);
  return v;
}

function int(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${key} en az ${min} olan bir tam sayı olmalı: "${raw}"`);
  return n;
}

export function loadConfig(env: Env): Config {
  return {
    kbRepo: path.resolve(required(env, 'KB_REPO')),
    kbRemote: env.KB_REMOTE ?? 'origin',
    kbBranch: env.KB_BRANCH ?? 'main',
    codeRepo: path.resolve(required(env, 'CODE_REPO')),
    codeRemote: env.CODE_REMOTE ?? 'origin',
    codeBranch: env.CODE_BRANCH ?? 'main',
    area: env.KB_AREA ?? 'backend',
    pollIntervalMs: int(env, 'POLL_INTERVAL_MS', 120_000, 1_000),
    batchThreshold: int(env, 'BATCH_THRESHOLD', 3, 1),
    maxAttempts: int(env, 'MAX_ATTEMPTS', 3, 1),
    validationRounds: int(env, 'VALIDATION_ROUNDS', 2),
    groupMaxDocs: int(env, 'GROUP_MAX_DOCS', 40, 1),
    limitBackoffMs: int(env, 'LIMIT_BACKOFF_MS', 30 * 60_000, 1_000),
    promptsDir: path.resolve(env.PROMPTS_DIR ?? DEFAULT_PROMPTS_DIR),
    claude: {
      bin: env.CLAUDE_BIN ?? 'claude',
      model: env.CLAUDE_MODEL ?? 'opus',
      maxTurns: int(env, 'CLAUDE_MAX_TURNS', 80, 1),
      timeoutMs: int(env, 'CLAUDE_TIMEOUT_MS', 60 * 60_000, 1_000),
    },
    author: {
      name: env.GIT_AUTHOR_NAME ?? 'kbsync',
      email: env.GIT_AUTHOR_EMAIL ?? 'kbsync@users.noreply.github.com',
    },
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || undefined,
    dryRun: env.DRY_RUN === '1' || env.DRY_RUN === 'true',
  };
}
