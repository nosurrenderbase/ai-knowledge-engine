/**
 * End to end: the official MCP client talks to our HTTP server, which reads a
 * throwaway index in the local Redis (compose.yaml). Skipped without Redis.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import type {AddressInfo} from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createClient} from 'redis';
import type {Principal, UsageEvent} from '@ai-knowledge-engine/accounts';
import {dropIndex, loadDotEnv, loadSearchConfig, syncIndex, type Embedder, type IndexTarget, type RedisClient} from '@ai-knowledge-engine/search';
import {createHttpServer} from '../src/http.ts';
import {KbStore, normalizeDocPath, splitArea} from '../src/kb-store.ts';
import {INSTRUCTIONS, type Services} from '../src/server.ts';

const DIM = 16;
const embedder: Embedder = {
  async embed(_model, texts) {
    const vectors = texts.map(t => {
      const v = new Float32Array(DIM);
      for (const w of t.toLowerCase().split(/\W+/u).filter(Boolean)) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % DIM] += 1;
      }
      v[0] += 0.01;
      return v;
    });
    return {vectors, tokens: 0};
  },
};

const DOCS: Record<string, string> = {
  'flows/pvp/gunluk-hak.md':
    '---\ntype: flow\nmodule: pvp-match\ntitle: PvP günlük hak\nstatus: canlıda\n---\n\n# PvP günlük hak\n\n## Kurallar\n\nOyuncu günde üç PvP maçı oynar.\n\n## Hatalar\n\nLimit dolunca `PVP_DAILY_LIMIT_REACHED` döner.\n',
  'flows/pvp/eski-bonus.md': '---\ntype: flow\nmodule: pvp-match\ntitle: Reklamla PvP bonusu\nstatus: kaldırıldı\n---\n\n# Bonus\n\n## Kural\n\nReklam izleyen oyuncuya üç maç daha verilirdi.\n',
  'genel/genel-bakis.md': '---\ntype: overview\ntitle: Genel bakış\n---\n\n# Genel bakış\n\n## Özet\n\nOyun baştan sona böyle işler.\n',
};

const FRONTEND_DOCS: Record<string, string> = {
  'flows/pvp/meydan-okuma.md':
    '---\ntype: flow\nmodule: pvp\ntitle: PvP davet ekranı\nstatus: canlıda\n---\n\n# PvP davet\n\n## Görünme koşulları\n\nDavet butonu yalnız oyuncunun günlük hakkı varsa görünür; `CreatePvpMatch` çağrılır.\n',
};

describe('paths', () => {
  it('normalizes area-relative paths the ways people write them', () => {
    for (const p of ['flows/x.md', './flows/x.md', 'flows/x', ' /flows/x.md ']) assert.equal(normalizeDocPath(p), 'flows/x.md', p);
  });

  it('splits the area off, defaulting to the backend', () => {
    const areas = ['backend', 'frontend'];
    assert.deepEqual(splitArea('frontend/api/x.md', areas), {area: 'frontend', path: 'api/x.md'});
    assert.deepEqual(splitArea('backend/flows/x.md', areas), {area: 'backend', path: 'flows/x.md'});
    assert.deepEqual(splitArea('flows/x.md', areas), {area: 'backend', path: 'flows/x.md'});
  });
});

await loadDotEnv(process.env);
let redis: RedisClient | null = null;
if (process.env.REDIS_PASSWORD) {
  const cfg = loadSearchConfig({...process.env, VOYAGE_API_KEY: 'x', VOYAGE_API_URL: 'x'});
  const c = createClient({url: cfg.redisUrl, password: cfg.redisPassword, socket: {connectTimeout: 2000, reconnectStrategy: false}});
  try {
    await c.connect();
    redis = c;
  } catch {
    redis = null;
  }
}

describe('MCP over HTTP', {skip: redis ? false : 'yerel Redis yok (docker compose up -d)'}, () => {
  const name = `test:mcp:${process.pid}:${Date.now()}`;
  const target: IndexTarget = {name, prefix: `${name}:c:`, dimension: DIM, model: 'fake'};
  const feName = `${name}:fe`;
  const feTarget: IndexTarget = {name: feName, prefix: `${feName}:c:`, dimension: DIM, model: 'fake'};
  const TOKEN = 'kb_0123abcd_test';
  const principal: Principal = {userId: 7, tokenId: 70, name: 'Ahmet'};
  const authenticate = async (t: string) => (t === TOKEN ? principal : null);
  const events: UsageEvent[] = [];
  let area: string;
  let feArea: string;
  let services: Services;
  let server: ReturnType<typeof createHttpServer>;
  let url: URL;
  let client: Client;

  before(async () => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-area-'));
    for (const [rel, text] of Object.entries(DOCS)) {
      fs.mkdirSync(path.dirname(path.join(area, rel)), {recursive: true});
      fs.writeFileSync(path.join(area, rel), text);
    }
    feArea = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-fe-area-'));
    for (const [rel, text] of Object.entries(FRONTEND_DOCS)) {
      fs.mkdirSync(path.dirname(path.join(feArea, rel)), {recursive: true});
      fs.writeFileSync(path.join(feArea, rel), text);
    }
    await syncIndex({client: redis!, voyage: embedder, target, areaDir: area, commit: 'abcdef1234567890', cacheDir: null});
    await syncIndex({client: redis!, voyage: embedder, target: feTarget, areaDir: feArea, commit: '1234567890abcdef', cacheDir: null, label: 'Frontend'});
    for (const n of [name, feName]) {
      for (;;) {
        const info = (await redis!.sendCommand(['FT.INFO', n])) as unknown[];
        if (Number(info[info.indexOf('percent_indexed') + 1]) >= 1) break;
        await new Promise(r => setTimeout(r, 50));
      }
    }
    services = {
      areas: new Map([
        ['backend', {store: new KbStore(redis!, target), search: {client: redis!, voyage: embedder, spec: target, model: 'fake'}}],
        ['frontend', {store: new KbStore(redis!, feTarget), search: {client: redis!, voyage: embedder, spec: feTarget, model: 'fake'}}],
      ]),
      usage: async (e: UsageEvent) => void events.push(e),
    };
    server = createHttpServer(services, {authenticate, log: () => {}});
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    client = new Client({name: 'test', version: '1'});
    await client.connect(new StreamableHTTPClientTransport(url, {requestInit: {headers: {authorization: `Bearer ${TOKEN}`}}}));
  });

  after(async () => {
    await client?.close();
    await new Promise(r => server.close(r));
    await dropIndex(redis!, target);
    await dropIndex(redis!, feTarget);
    for await (const keys of redis!.scanIterator({MATCH: `${name}*`, COUNT: 500})) if (keys.length) await redis!.del(keys);
    await redis!.quit();
    fs.rmSync(area, {recursive: true, force: true});
    fs.rmSync(feArea, {recursive: true, force: true});
  });

  const callText = async (tool: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({name: tool, arguments: args})) as {content: {text: string}[]; isError?: boolean};
    return {text: res.content[0].text, isError: res.isError ?? false};
  };

  it('introduces itself with instructions and four read-only tools', async () => {
    assert.equal(client.getInstructions(), INSTRUCTIONS);
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['grep', 'list_docs', 'read_doc', 'search']);
    assert.ok(tools.every(t => t.annotations?.readOnlyHint === true));
  });

  it('search returns the right section and hides removed documents', async () => {
    const {text} = await callText('search', {query: 'günde kaç pvp maçı', limit: 3});
    assert.match(text, /^\d+ sonuç \(bilgi tabanı: backend abcdef12, frontend 12345678\)/);
    assert.match(text, /1\. \*\*PvP günlük hak\*\* — `backend\/flows\/pvp\/gunluk-hak\.md` › Kurallar \[canlıda\]/);
    assert.doesNotMatch(text, /eski-bonus/);
    const removed = await callText('search', {query: 'reklam izleyen oyuncuya maç', include_removed: true, limit: 1});
    assert.match(removed.text, /eski-bonus\.md.*\[kaldırıldı\]/);
  });

  it('read_doc returns the whole document, and a clear error for unknown paths', async () => {
    const {text} = await callText('read_doc', {path: 'backend/flows/pvp/gunluk-hak'});
    assert.equal(text, DOCS['flows/pvp/gunluk-hak.md']);
    const missing = await callText('read_doc', {path: 'flows/yok.md'});
    assert.equal(missing.isError, true);
    assert.match(missing.text, /bulunamadı/);
  });

  it('grep finds exact text case-insensitively with line numbers', async () => {
    const {text} = await callText('grep', {pattern: 'pvp_daily_limit_reached'});
    assert.match(text, /^1 eşleşme:\nbackend\/flows\/pvp\/gunluk-hak\.md:16: Limit dolunca `PVP_DAILY_LIMIT_REACHED` döner\.$/);
    const none = await callText('grep', {pattern: 'olmayan metin'});
    assert.match(none.text, /hiçbir dokümanda geçmiyor/);
  });

  it('list_docs lists titles and status, optionally by folder', async () => {
    const all = await callText('list_docs', {});
    assert.match(all.text, /^4 doküman:/);
    assert.match(all.text, /frontend\/flows\/pvp\/meydan-okuma\.md — PvP davet ekranı \[canlıda\]/);
    const flows = await callText('list_docs', {prefix: 'backend/flows/pvp/'});
    assert.match(flows.text, /flows\/pvp\/eski-bonus\.md — Reklamla PvP bonusu \[kaldırıldı\]/);
    assert.doesNotMatch(flows.text, /genel-bakis/);
  });

  it('reports 503 on health and refuses tool calls while the store is not ready', async () => {
    let ready = false;
    const s = createHttpServer(services, {authenticate, log: () => {}, ready: () => ready});
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${base}/health`)).status, 503);
    const call = await fetch(`${base}/mcp`, {method: 'POST', headers: {authorization: `Bearer ${TOKEN}`}, body: '{}'});
    assert.equal(call.status, 503);
    assert.match(JSON.stringify(await call.json()), /erişilemiyor/);
    ready = true;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    await new Promise(r => s.close(r));
  });

  it('searches both areas by default, one when asked, and reads frontend documents', async () => {
    const both = await callText('search', {query: 'pvp davet butonu günlük hak', limit: 5});
    assert.match(both.text, /`frontend\/flows\/pvp\/meydan-okuma\.md`/);
    assert.match(both.text, /`backend\/flows\/pvp\/gunluk-hak\.md`/);
    const fe = await callText('search', {query: 'pvp davet butonu', area: 'frontend'});
    assert.doesNotMatch(fe.text, /backend\//);
    const doc = await callText('read_doc', {path: 'frontend/flows/pvp/meydan-okuma.md'});
    assert.equal(doc.text, FRONTEND_DOCS['flows/pvp/meydan-okuma.md']);
    const g = await callText('grep', {pattern: 'createpvpmatch', prefix: 'frontend/flows/'});
    assert.match(g.text, /^1 eşleşme:\nfrontend\/flows\/pvp\/meydan-okuma\.md:/);
  });

  it('skips an area whose index does not exist yet', async () => {
    const ghost: IndexTarget = {name: `${name}:yok`, prefix: `${name}:yok:c:`, dimension: DIM, model: 'fake'};
    services.areas.set('ghost', {store: new KbStore(redis!, ghost), search: {client: redis!, voyage: embedder, spec: ghost, model: 'fake'}});
    try {
      const {text, isError} = await callText('search', {query: 'günde kaç pvp maçı', limit: 2});
      assert.equal(isError, false);
      assert.match(text, /gunluk-hak/);
    } finally {
      services.areas.delete('ghost');
    }
  });

  it('records every tool call with who asked, what, what came back and the client', async () => {
    events.length = 0;
    await callText('search', {query: 'günde kaç pvp maçı', limit: 3});
    await callText('read_doc', {path: 'flows/yok.md'});
    await new Promise(r => setImmediate(r));
    assert.equal(events.length, 2);
    const [s, r] = events;
    assert.equal(s.userId, 7);
    assert.equal(s.tokenId, 70);
    assert.equal(s.tool, 'search');
    assert.equal(s.input.query, 'günde kaç pvp maçı');
    assert.ok(Number(s.result.count) > 0);
    assert.equal((s.result.paths as string[])[0], 'backend/flows/pvp/gunluk-hak.md');
    assert.ok(s.durationMs >= 0);
    assert.equal(s.error, null);
    assert.ok(s.client, 'istemci (User-Agent) kaydedilir');
    assert.equal(r.tool, 'read_doc');
    assert.match(r.error ?? '', /bulunamadı/);
  });

  it('answers 503 (not 401) when the token store is down', async () => {
    const s = createHttpServer(services, {
      authenticate: async () => {
        throw new Error('postgres kapalı');
      },
      log: () => {},
    });
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/mcp`, {method: 'POST', headers: {authorization: `Bearer ${TOKEN}`}, body: '{}'});
    assert.equal(res.status, 503);
    await new Promise(r => s.close(r));
  });

  it('rejects requests without the token, non-POST methods and bad JSON; health needs no token', async () => {
    const noAuth = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    assert.equal(noAuth.status, 401);
    const wrong = await fetch(url, {method: 'POST', headers: {authorization: 'Bearer yanlis'}, body: '{}'});
    assert.equal(wrong.status, 401);
    const get = await fetch(url, {headers: {authorization: `Bearer ${TOKEN}`}});
    assert.equal(get.status, 405);
    const bad = await fetch(url, {method: 'POST', headers: {authorization: `Bearer ${TOKEN}`}, body: '{bozuk'});
    assert.equal(bad.status, 400);
    const health = await fetch(new URL('/health', url));
    assert.deepEqual(await health.json(), {ok: true});
  });
});
