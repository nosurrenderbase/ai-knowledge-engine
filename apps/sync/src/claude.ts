import {exec} from './exec.ts';

/** Final JSON report the agent must return (UPDATE-PROMPT.md section 2, "BİTİŞ"). */
export interface Report {
  updated: {path: string; sections: string[]; reason: string}[];
  created: {path: string; reason: string}[];
  retired: {path: string; reason: string}[];
  no_change: {path: string; reason: string}[];
  value_changes: {doc: string; rule: string; old: string; new: string; source: string}[];
  findings: {severity: 'high' | 'medium' | 'low'; path: string; summary: string}[];
  open_questions: string[];
}

const obj = (props: Record<string, object>) => ({
  type: 'object',
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});
const str = {type: 'string'};
const list = (items: object) => ({type: 'array', items});

export const REPORT_SCHEMA = obj({
  updated: list(obj({path: str, sections: list(str), reason: str})),
  created: list(obj({path: str, reason: str})),
  retired: list(obj({path: str, reason: str})),
  no_change: list(obj({path: str, reason: str})),
  value_changes: list(obj({doc: str, rule: str, old: str, new: str, source: str})),
  findings: list(obj({severity: {type: 'string', enum: ['high', 'medium', 'low']}, path: str, summary: str})),
  open_questions: list(str),
});

export interface ClaudeConfig {
  bin: string;
  model: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface ClaudeRequest {
  /** Knowledge base repo root: Claude's working directory. */
  cwd: string;
  /** Area directory (absolute), the only place Claude may write. */
  areaDir: string;
  /** Code worktree (absolute), readable only. */
  codeDir: string;
  systemPrompt: string;
  message: string;
  /** Continue an earlier session (validation feedback). */
  resume?: string;
}

export type ClaudeOutcome =
  | {kind: 'ok'; sessionId: string; report: Report; costUsd: number | null; turns: number | null}
  | {kind: 'limit'; resetAt: Date | null; message: string}
  | {kind: 'error'; message: string; sessionId: string | null};

/**
 * Permission rules for the unattended run. `dontAsk` denies everything not
 * allowed here. Paths are absolute (`//` prefix) so they do not depend on
 * where the settings are loaded from.
 */
export function permissionSettings(areaDir: string, codeDir: string): object {
  // Permission rules mark absolute paths with a leading "//".
  const area = `/${areaDir}`;
  const code = codeDir;
  return {
    permissions: {
      allow: [
        'Read',
        'Grep',
        'Glob',
        `Edit(${area}/**/*.md)`,
        `Write(${area}/**/*.md)`,
        `Bash(git -C ${code} diff:*)`,
        `Bash(git -C ${code} show:*)`,
        `Bash(git -C ${code} log:*)`,
      ],
      deny: [
        'Read(**/.env*)',
        `Read(/${code}/**/.env*)`,
        `Read(/${code}/.env*)`,
        `Edit(${area}/.source-commit)`,
        `Edit(${area}/README.md)`,
        `Write(${area}/.source-commit)`,
        `Write(${area}/README.md)`,
        'Bash(git commit:*)',
        'Bash(git push:*)',
        'WebFetch',
        'WebSearch',
      ],
    },
  };
}

export function buildArgs(cfg: ClaudeConfig, req: ClaudeRequest): string[] {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(REPORT_SCHEMA),
    '--permission-mode', 'dontAsk',
    '--model', cfg.model,
    '--max-turns', String(cfg.maxTurns),
    '--add-dir', req.codeDir,
    '--setting-sources', '',
    '--settings', JSON.stringify(permissionSettings(req.areaDir, req.codeDir)),
    '--append-system-prompt', req.systemPrompt,
  ];
  if (req.resume) args.push('--resume', req.resume);
  return args;
}

const LIMIT_PATTERN = /(hit your [\w\s-]*limit|usage limit reached|rate_limit_error|limit will reset)/i;

/**
 * Reads a reset time like "resets 3pm", "resets at 15:30" or "resets 9:05am"
 * and returns its next occurrence after `now` (plus a minute of slack).
 */
export function parseResetTime(text: string, now: Date): Date | null {
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return new Date(at.getTime() + 60_000);
}

export function detectLimit(text: string, now: Date): {resetAt: Date | null; message: string} | null {
  const m = LIMIT_PATTERN.exec(text);
  if (!m) return null;
  const line = text.split('\n').find(l => LIMIT_PATTERN.test(l)) ?? m[0];
  return {resetAt: parseResetTime(text, now), message: line.trim().slice(0, 300)};
}

interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
}

/** Interprets the CLI's `--output-format json` output. */
export function interpretOutput(code: number, stdout: string, stderr: string, now: Date): ClaudeOutcome {
  let parsed: CliResult | null = null;
  try {
    parsed = JSON.parse(stdout.trim()) as CliResult;
  } catch {
    parsed = null;
  }
  const text = [parsed?.result ?? '', stdout, stderr].join('\n');
  const failed = code !== 0 || !parsed || parsed.is_error === true || parsed.subtype !== 'success';
  const report = parsed?.structured_output;
  if (failed || !isReport(report)) {
    // A limit can arrive as an error or as a "successful" run without a report.
    const limit = detectLimit(text, now);
    if (limit) return {kind: 'limit', ...limit};
  }
  if (failed) {
    const why = parsed?.subtype && parsed.subtype !== 'success' ? parsed.subtype : `çıkış kodu ${code}`;
    const detail = (parsed?.result ?? (stderr || stdout)).trim().slice(0, 500);
    return {kind: 'error', message: `claude başarısız (${why}): ${detail}`, sessionId: parsed?.session_id ?? null};
  }
  if (!isReport(report)) {
    return {kind: 'error', message: 'claude JSON raporu şemaya uymuyor', sessionId: parsed!.session_id ?? null};
  }
  return {
    kind: 'ok',
    sessionId: parsed!.session_id ?? '',
    report,
    costUsd: parsed!.total_cost_usd ?? null,
    turns: parsed!.num_turns ?? null,
  };
}

function isReport(value: unknown): value is Report {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return ['updated', 'created', 'retired', 'no_change', 'value_changes', 'findings', 'open_questions'].every(k =>
    Array.isArray(r[k]),
  );
}

export async function runClaude(cfg: ClaudeConfig, req: ClaudeRequest, now = () => new Date()): Promise<ClaudeOutcome> {
  const res = await exec(cfg.bin, buildArgs(cfg, req), {
    cwd: req.cwd,
    input: req.message,
    timeoutMs: cfg.timeoutMs,
  });
  return interpretOutput(res.code, res.stdout, res.stderr, now());
}
