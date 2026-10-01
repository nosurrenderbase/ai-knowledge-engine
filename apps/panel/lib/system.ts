/**
 * The system page's checks: each running part of the knowledge engine,
 * reached the way it is actually used, with how long it took.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {services} from './services';

export type Health = 'ok' | 'warn' | 'bad' | 'off';

export interface Check {
  name: string;
  health: Health;
  detail: string;
  ms?: number;
}

export interface SystemView {
  checks: Check[];
  areas: {area: string; kind: string; until?: string}[];
  heartbeatAt: string | null;
  disk: {freeGb: number; totalGb: number; usedPct: number} | null;
  logs: {source: string; time: string; level: string; msg: string; area?: string; error?: string}[];
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};
const minutesSince = (iso?: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 60_000 : Infinity);

async function timed(name: string, fn: () => Promise<Omit<Check, 'name' | 'ms'>>): Promise<Check> {
  const t = performance.now();
  try {
    return {name, ...(await fn()), ms: Math.round(performance.now() - t)};
  } catch (e) {
    return {name, health: 'bad', detail: (e as Error).message.slice(0, 160), ms: Math.round(performance.now() - t)};
  }
}

/** Last warnings and errors of the worker and deploy logs (JSON lines). */
function recentProblems(dir: string | undefined, limit = 12): SystemView['logs'] {
  if (!dir) return [];
  const out: SystemView['logs'] = [];
  for (const [source, file] of [['işçi', 'kbsync.log'], ['deploy', 'deploy.log']] as const) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const e = JSON.parse(line) as {time: string; level: string; msg: string; area?: string; error?: string};
        if (e.level === 'warn' || e.level === 'error') out.push({source, time: e.time, level: e.level, msg: e.msg, area: e.area, error: e.error?.slice(0, 240)});
      } catch {
        // a partial line at the cut
      }
    }
  }
  return out.sort((a, b) => b.time.localeCompare(a.time)).slice(0, limit);
}

export async function readSystem(env = process.env): Promise<SystemView> {
  const {db, redis} = await services();
  const stateDir = env.WORKER_STATE_DIR;
  const hb = stateDir ? readJson<{at: string; areas: {area: string; kind: string; until?: string}[]}>(path.join(stateDir, 'kbsync-heartbeat.json')) : null;
  const busy = stateDir ? readJson<{area: string; since: string}>(path.join(stateDir, 'kbsync-busy.json')) : null;
  const deployHb = env.DEPLOY_STATE_FILE ? readJson<{at: string; result?: string; error?: string; settings?: number}>(path.join(path.dirname(env.DEPLOY_STATE_FILE), 'heartbeat.json')) : null;

  const checks = await Promise.all([
    timed('Redis (arama)', async () => {
      const pong = await redis.ping();
      const info = await redis.info('memory');
      const mem = info.match(/used_memory_human:(\S+)/)?.[1];
      return {health: pong === 'PONG' ? 'ok' : 'bad', detail: `yanıt veriyor${mem ? ` · ${mem} bellek` : ''}`};
    }),
    timed('Postgres (hesaplar)', async () => {
      const {rows} = await db.query(`select pg_size_pretty(pg_database_size(current_database())) as size`);
      return {health: 'ok', detail: `yanıt veriyor · ${rows[0].size}`};
    }),
    timed('MCP sunucusu', async () => {
      if (!env.MCP_HEALTH_URL) return {health: 'off', detail: 'adres tanımlı değil'};
      const r = await fetch(env.MCP_HEALTH_URL, {signal: AbortSignal.timeout(3000)});
      const j = (await r.json()) as {ok: boolean; version?: string};
      return {health: j.ok ? 'ok' : 'bad', detail: j.ok ? `hazır · ${j.version?.slice(0, 7) ?? '?'}` : 'hazır değil (Redis ya da Postgres bekleniyor)'};
    }),
    timed('Oyun veritabanı', async () => {
      if (!env.MCP_HEALTH_URL) return {health: 'off', detail: '—'};
      const j = (await (await fetch(env.MCP_HEALTH_URL, {signal: AbortSignal.timeout(3000)})).json()) as {gamedb?: boolean | null};
      if (j.gamedb === null || j.gamedb === undefined) return {health: 'off', detail: 'bağlı değil (MONGO_RO_URI yok)'};
      return {health: j.gamedb ? 'ok' : 'bad', detail: j.gamedb ? 'MCP bağlı, salt okunur' : 'MCP bağlanamıyor'};
    }),
    timed('Cloudflare tüneli', async () => {
      if (!env.TUNNEL_CHECK_URL) return {health: 'off', detail: 'kontrol adresi yok'};
      const r = await fetch(env.TUNNEL_CHECK_URL, {signal: AbortSignal.timeout(6000)});
      return {health: r.ok ? 'ok' : 'bad', detail: r.ok ? 'dışarıdan erişilebiliyor' : `dışarıdan ${r.status}`};
    }),
    timed('İşçi (senkron)', async () => {
      const age = minutesSince(hb?.at);
      if (busy) return {health: 'ok', detail: `${busy.area} işleniyor · ${Math.round(minutesSince(busy.since))} dk`};
      if (age === Infinity) return {health: 'warn', detail: 'henüz tur bilgisi yok'};
      const blocked = hb!.areas.filter(a => a.kind === 'blocked').map(a => a.area);
      if (blocked.length) return {health: 'bad', detail: `sıra durdu: ${blocked.join(', ')}`};
      if (age > 10) return {health: 'bad', detail: `${Math.round(age)} dk'dır tur yok`};
      return {health: 'ok', detail: `son tur ${Math.max(0, Math.round(age))} dk önce`};
    }),
    timed('Deploy ajanı', async () => {
      const age = minutesSince(deployHb?.at);
      if (age === Infinity) return {health: 'warn', detail: 'henüz tur bilgisi yok'};
      if (age > 8) return {health: 'bad', detail: `${Math.round(age)} dk'dır çalışmadı`};
      if (deployHb!.error) return {health: 'warn', detail: `son tur hata: ${deployHb!.error.slice(0, 80)}`};
      return {health: 'ok', detail: `son tur ${Math.max(0, Math.round(age))} dk önce · ${deployHb!.result ?? ''}`};
    }),
  ]);

  let disk: SystemView['disk'] = null;
  try {
    const s = fs.statfsSync(env.LOGS_DIR || '/');
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    disk = {freeGb: free / 1e9, totalGb: total / 1e9, usedPct: Math.round(((total - free) / total) * 100)};
    checks.push({name: 'Disk', health: disk.usedPct > 90 ? 'bad' : disk.usedPct > 80 ? 'warn' : 'ok', detail: `${disk.freeGb.toFixed(0)} GB boş · %${disk.usedPct} dolu`});
  } catch {
    // not available in this environment
  }

  return {checks, areas: hb?.areas ?? [], heartbeatAt: hb?.at ?? null, disk, logs: recentProblems(env.LOGS_DIR)};
}
