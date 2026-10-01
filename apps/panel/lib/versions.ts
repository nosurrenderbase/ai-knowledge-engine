/**
 * What is running where: the commit the deploy job last put live, the commit
 * each service is actually running (the worker's version file, the MCP's
 * /health, this panel's own build), whether a worker job is in progress, and
 * up to which code commit each knowledge base area has been synced.
 * Every source is optional: a missing file or an unreachable service shows as "bilinmiyor".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {AREA_REPOS, AREAS} from './areas';

export interface ServiceVersion {
  name: string;
  sha: string | null;
  /** What the last deploy that touched this service put live; null before the first such deploy. */
  expected: string | null;
  since?: string | null;
  note?: string;
}

export interface Versions {
  live: {sha: string | null; at: string | null; previous: string | null};
  failedSha: string | null;
  pendingWorker: boolean;
  services: ServiceVersion[];
  busy: {area: string; head: string; since: string} | null;
  areas: {area: string; sourceCommit: string | null; repo: string}[];
}

function readJson<T>(file: string | undefined): T | null {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

const known = (v: string | undefined | null) => (v && v !== 'unknown' ? v : null);

export async function readVersions(env = process.env): Promise<Versions> {
  const state = readJson<{
    deployedSha?: string;
    deployedAt?: string;
    previousSha?: string;
    failedSha?: string;
    pendingWorker?: boolean;
    services?: Record<string, string>;
  }>(env.DEPLOY_STATE_FILE);
  const expected = (k: string) => state?.services?.[k] ?? null;
  const stateDir = env.WORKER_STATE_DIR;
  const worker = readJson<{sha?: string; startedAt?: string}>(stateDir && path.join(stateDir, 'kbsync-version.json'));
  const busy = readJson<{area: string; head: string; since: string}>(stateDir && path.join(stateDir, 'kbsync-busy.json'));

  let mcp: {version?: string | null} | null = null;
  if (env.MCP_HEALTH_URL) {
    try {
      mcp = (await (await fetch(env.MCP_HEALTH_URL, {signal: AbortSignal.timeout(2000)})).json()) as {version?: string | null};
    } catch {
      mcp = null;
    }
  }

  const sourceCommit = (area: string) => {
    if (!env.KB_CLONE_DIR) return null;
    try {
      return fs.readFileSync(path.join(env.KB_CLONE_DIR, area, '.source-commit'), 'utf8').trim() || null;
    } catch {
      return null;
    }
  };

  return {
    live: {sha: state?.deployedSha ?? null, at: state?.deployedAt ?? null, previous: state?.previousSha ?? null},
    failedSha: state?.failedSha ?? null,
    pendingWorker: Boolean(state?.pendingWorker),
    services: [
      {name: 'İşçi', sha: known(worker?.sha), expected: expected('worker'), since: worker?.startedAt ?? null},
      {name: 'MCP', sha: known(mcp?.version), expected: expected('mcp'), note: mcp ? undefined : 'erişilemiyor'},
      {name: 'Panel', sha: known(env.APP_VERSION), expected: expected('panel')},
    ],
    busy,
    areas: AREAS.map(area => ({area, sourceCommit: sourceCommit(area), repo: AREA_REPOS[area]})),
  };
}
