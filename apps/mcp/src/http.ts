/**
 * Streamable HTTP endpoint, stateless: every POST /mcp gets a fresh MCP server
 * and transport. GET /health answers without auth (for Docker healthchecks).
 */
import * as http from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Principal} from '@ai-knowledge-engine/accounts';
import {buildServer, type Services} from './server.ts';

export interface HttpOptions {
  /** Maps a presented bearer token to its owner; null means "not allowed". */
  authenticate: (token: string) => Promise<Principal | null>;
  log: (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
  /** Whether the data store is reachable; while false, /health is 503 and /mcp refuses politely. */
  ready?: () => boolean;
}

const MAX_BODY = 1024 * 1024;

function bearer(req: http.IncomingMessage): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (b: Buffer) => {
      size += b.length;
      if (size > MAX_BODY) {
        reject(new Error('gövde çok büyük'));
        req.destroy();
      } else parts.push(b);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

const rpcError = (code: number, message: string) => ({jsonrpc: '2.0', error: {code, message}, id: null});

export function createHttpServer(services: Services, opts: HttpOptions): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ready = opts.ready?.() ?? true;
    if (url.pathname === '/health') return json(res, ready ? 200 : 503, {ok: ready, version: process.env.APP_VERSION ?? null});
    if (url.pathname !== '/mcp') return json(res, 404, {error: 'bulunamadı'});
    if (!ready) return json(res, 503, rpcError(-32002, 'bilgi tabanı şu an erişilemiyor, biraz sonra tekrar dene'));
    const token = bearer(req);
    let principal: Principal | null = null;
    try {
      principal = token ? await opts.authenticate(token) : null;
    } catch (e) {
      opts.log('error', 'token doğrulanamadı', {error: (e as Error).message});
      return json(res, 503, rpcError(-32002, 'kimlik doğrulama şu an yapılamıyor, biraz sonra tekrar dene'));
    }
    if (!principal) {
      res.setHeader('www-authenticate', 'Bearer');
      return json(res, 401, rpcError(-32001, 'yetkisiz'));
    }
    // Stateless server: no server-initiated streams, no sessions to delete.
    if (req.method !== 'POST') return json(res, 405, rpcError(-32000, 'yalnız POST'));

    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, rpcError(-32700, 'geçersiz JSON'));
    }
    const server = buildServer(services, {principal, client: req.headers['user-agent']?.slice(0, 200) ?? null});
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      opts.log('error', 'mcp isteği başarısız', {error: (e as Error).message});
      if (!res.headersSent) json(res, 500, rpcError(-32603, 'sunucu hatası'));
    }
  });
}
