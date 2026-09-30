/**
 * Streamable HTTP endpoint, stateless: every POST /mcp gets a fresh MCP server
 * and transport. GET /health answers without auth (for Docker healthchecks).
 */
import {timingSafeEqual} from 'node:crypto';
import * as http from 'node:http';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {buildServer, type Services} from './server.ts';

export interface HttpOptions {
  /** Required bearer token; null disables auth (tests only). */
  token: string | null;
  log: (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}

const MAX_BODY = 1024 * 1024;

function authorized(req: http.IncomingMessage, token: string | null): boolean {
  if (token === null) return true;
  const header = req.headers.authorization ?? '';
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
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
    if (url.pathname === '/health') return json(res, 200, {ok: true});
    if (url.pathname !== '/mcp') return json(res, 404, {error: 'bulunamadı'});
    if (!authorized(req, opts.token)) {
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
    const server = buildServer(services);
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
