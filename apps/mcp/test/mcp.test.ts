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
import {dropIndex, loadDotEnv, loadSearchConfig, syncIndex, type Embedder, type IndexTarget, type RedisClient} from '@ai-knowledge-engine/search';
import {createHttpServer} from '../src/http.ts';
import {KbStore, normalizeDocPath} from '../src/kb-store.ts';
import {INSTRUCTIONS} from '../src/server.ts';

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

describe('normalizeDocPath', () => {
  it('accepts the ways people write a document path', () => {
    for (const p of ['flows/x.md', './flows/x.md', 'backend/flows/x.md', 'flows/x', ' /flows/x.md ']) {
      assert.equal(normalizeDocPath(p), 'flows/x.md', p);
    }
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
  const TOKEN = 'test-token';
  let area: string;
  let server: ReturnType<typeof createHttpServer>;
  let url: URL;
  let client: Client;

  before(async () => {
    area = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-area-'));
    for (const [rel, text] of Object.entries(DOCS)) {
      fs.mkdirSync(path.dirname(path.join(area, rel)), {recursive: true});
      fs.writeFileSync(path.join(area, rel), text);
    }
    await syncIndex({client: redis!, voyage: embedder, target, areaDir: area, commit: 'abcdef1234567890', cacheDir: null});
    for (;;) {
      const info = (await redis!.sendCommand(['FT.INFO', name])) as unknown[];
      if (Number(info[info.indexOf('percent_indexed') + 1]) >= 1) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const services = {store: new KbStore(redis!, target), search: {client: redis!, voyage: embedder, spec: target, model: 'fake'}};
    server = createHttpServer(services, {token: TOKEN, log: () => {}});
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    client = new Client({name: 'test', version: '1'});
    await client.connect(new StreamableHTTPClientTransport(url, {requestInit: {headers: {authorization: `Bearer ${TOKEN}`}}}));
  });

  after(async () => {
    await client?.close();
    await new Promise(r => server.close(r));
    await dropIndex(redis!, target);
    for await (const keys of redis!.scanIterator({MATCH: `${name}*`, COUNT: 500})) if (keys.length) await redis!.del(keys);
    await redis!.quit();
    fs.rmSync(area, {recursive: true, force: true});
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
    assert.match(text, /^\d+ sonuç \(bilgi tabanı commit abcdef12\)/);
    assert.match(text, /1\. \*\*PvP günlük hak\*\* — `flows\/pvp\/gunluk-hak\.md` › Kurallar \[canlıda\]/);
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
    assert.match(text, /^1 eşleşme:\nflows\/pvp\/gunluk-hak\.md:16: Limit dolunca `PVP_DAILY_LIMIT_REACHED` döner\.$/);
    const none = await callText('grep', {pattern: 'olmayan metin'});
    assert.match(none.text, /hiçbir dokümanda geçmiyor/);
  });

  it('list_docs lists titles and status, optionally by folder', async () => {
    const all = await callText('list_docs', {});
    assert.match(all.text, /^3 doküman:/);
    const flows = await callText('list_docs', {prefix: 'flows/pvp/'});
    assert.match(flows.text, /flows\/pvp\/eski-bonus\.md — Reklamla PvP bonusu \[kaldırıldı\]/);
    assert.doesNotMatch(flows.text, /genel-bakis/);
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
