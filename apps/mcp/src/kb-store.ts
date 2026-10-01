/**
 * Read access to the knowledge base as indexed in Redis: full documents,
 * listings and exact-text search. Everything comes from the same commit the
 * search index is at, so search hits and document text never disagree.
 */
import {docHashesKey, docKey, readMeta, type IndexSpec, type RedisClient} from '@ai-knowledge-engine/search';

export interface StoredDoc {
  path: string;
  title: string;
  kind: string;
  module: string;
  status: string;
  text: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

/** Normalises an area-relative path the way readers type it: "./flows/x.md", "flows/x". */
export function normalizeDocPath(input: string): string {
  let p = input.trim().replace(/^\.?\//, '');
  if (!p.endsWith('.md')) p += '.md';
  return p;
}

/**
 * Splits "frontend/flows/x.md" into area and area-relative path. Paths without
 * a known area are the backend's (the only area there was at first).
 */
export function splitArea(input: string, areas: readonly string[]): {area: string; path: string} {
  const p = input.trim().replace(/^\.?\//, '');
  const first = p.split('/')[0];
  if (areas.includes(first)) return {area: first, path: p.slice(first.length + 1)};
  return {area: 'backend', path: p};
}

/** Case-insensitive the Turkish way, but keeping code names intact (I → i, İ → i). */
const fold = (s: string) => s.replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase();

export class KbStore {
  private readonly client: RedisClient;
  private readonly spec: IndexSpec;
  /** All documents, loaded once per indexed commit (for listing and grep). */
  private cache: {commit: string; docs: StoredDoc[]} | null = null;

  constructor(client: RedisClient, spec: IndexSpec) {
    this.client = client;
    this.spec = spec;
  }

  async commit(): Promise<string> {
    return (await readMeta(this.client, this.spec)).commit ?? '';
  }

  async getDoc(docPath: string): Promise<StoredDoc | null> {
    const f = (await this.client.hGetAll(docKey(this.spec, normalizeDocPath(docPath)))) as Record<string, string>;
    if (!f.path) return null;
    return {path: f.path, title: f.title, kind: f.kind, module: f.module, status: f.status, text: f.text};
  }

  private async all(): Promise<StoredDoc[]> {
    const commit = await this.commit();
    if (this.cache?.commit === commit) return this.cache.docs;
    const paths = Object.keys((await this.client.hGetAll(docHashesKey(this.spec))) as Record<string, string>).sort();
    const multi = this.client.multi();
    for (const p of paths) multi.hGetAll(docKey(this.spec, p));
    const docs = ((await multi.exec()) as unknown as Record<string, string>[])
      .filter(f => f && f.path)
      .map(f => ({path: f.path, title: f.title, kind: f.kind, module: f.module, status: f.status, text: f.text}));
    this.cache = {commit, docs};
    return docs;
  }

  async list(prefix = ''): Promise<Omit<StoredDoc, 'text'>[]> {
    const p = prefix.replace(/^\.?\//, '');
    return (await this.all()).filter(d => d.path.startsWith(p)).map(({text: _text, ...rest}) => rest);
  }

  /** Lines containing `needle` (case-insensitive), at most `limit`. */
  async grep(needle: string, opts: {prefix?: string; limit?: number} = {}): Promise<{matches: GrepMatch[]; truncated: boolean}> {
    const want = fold(needle);
    const limit = opts.limit ?? 50;
    const prefix = (opts.prefix ?? '').replace(/^\.?\//, '');
    const matches: GrepMatch[] = [];
    for (const doc of await this.all()) {
      if (!doc.path.startsWith(prefix)) continue;
      const lines = doc.text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!fold(lines[i]).includes(want)) continue;
        if (matches.length >= limit) return {matches, truncated: true};
        matches.push({path: doc.path, line: i + 1, text: lines[i].trim().slice(0, 300)});
      }
    }
    return {matches, truncated: false};
  }
}
