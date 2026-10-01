/**
 * Builds embedding-ready chunks from the knowledge base (chunks.jsonl).
 *
 * One JSON object per line: {id, hash, path, kind, embed_text, text, meta}
 *  - id:         "<path>#<heading path>[#part N]" — stable across runs while
 *                the file path and headings stay the same (incremental index key)
 *  - hash:       sha256 of embed_text — re-embed only when it changes
 *  - embed_text: what goes to the embedding model (breadcrumb + section text)
 *  - text:       the full section (incl. Mermaid) for display / full-text search
 *  - meta:       frontmatter fields for filtering (type, module, status, jira,
 *                aliases, code_commit, sources, related) + headings
 *
 * Rules (see docs/EMBEDDING.md):
 *  - Split by ## / ### headings; a section longer than MAX_CHARS is split
 *    further, tables by row groups with the header row repeated.
 *  - Mermaid blocks are removed from embed_text (kept in text).
 *  - Every embed_text starts with a breadcrumb line:
 *      "<area> › <title> › <heading path>" + aliases line.
 *  - Use case cards: only the title + "Ne yapar" paragraph is embedded; the
 *    generated tables stay in `text` for full-text search and exact lookup.
 *  - status: kaldırıldı documents are emitted with meta.status so the index can
 *    exclude them by default.
 *
 * Library: buildChunks(areaDir). CLI: see cli.ts.
 */
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {manualPart} from './cards.ts';
import {parseDoc} from './docs.ts';

export const MAX_CHARS = 2400;

export interface Chunk {
  id: string;
  hash: string;
  path: string;
  kind: string;
  embed_text: string;
  text: string;
  meta: Record<string, unknown>;
}

interface Section { headings: string[]; text: string; }

/** Splits a markdown body into sections by ## and ### (the # title opens the doc). */
function sections(body: string): Section[] {
  const out: Section[] = [];
  let h2 = '';
  let h3 = '';
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({headings: [h2, h3].filter(Boolean), text});
    buf = [];
  };
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && /^#\s/.test(line)) { flush(); h2 = ''; h3 = ''; continue; }
    if (!inFence && /^##\s/.test(line)) { flush(); h2 = line.replace(/^##\s+/, ''); h3 = ''; continue; }
    if (!inFence && /^###\s/.test(line)) { flush(); h3 = line.replace(/^###\s+/, ''); continue; }
    buf.push(line);
  }
  flush();
  return out;
}

const stripMermaid = (t: string) => t.replace(/```mermaid[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();

/** Splits long text: tables by row groups (header repeated), other text by paragraphs. */
function splitLong(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const parts: string[] = [];
  const blocks = text.split(/\n{2,}/);
  let cur = '';
  const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ''; };
  for (const block of blocks) {
    const lines = block.split('\n');
    const isTable = lines.length > 2 && lines[0].startsWith('|') && /^\|\s*:?-/.test(lines[1]);
    if (isTable && block.length > MAX_CHARS) {
      push();
      const header = lines.slice(0, 2).join('\n');
      let rows: string[] = [];
      for (const row of lines.slice(2)) {
        if ((header.length + rows.join('\n').length + row.length) > MAX_CHARS && rows.length) {
          parts.push(`${header}\n${rows.join('\n')}`);
          rows = [];
        }
        rows.push(row);
      }
      if (rows.length) parts.push(`${header}\n${rows.join('\n')}`);
      continue;
    }
    if (cur.length + block.length + 2 > MAX_CHARS) push();
    cur += (cur ? '\n\n' : '') + block;
  }
  push();
  return parts;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

const AREA: Record<string, string> = {
  flows: 'Akış', modules: 'Modül', usecases: 'Use case kartı', genel: 'Genel', api: 'API işlemi', ekranlar: 'Ekran',
};

/** Folders of an area that hold documents (everything else is process files). */
export const DOC_DIRS = ['genel', 'flows', 'modules', 'usecases', 'api', 'ekranlar'];

export interface ChunkOptions {
  /** Prefix of every breadcrumb, e.g. "Frontend". Omitted for the backend so its hashes stay as they were. */
  label?: string;
}

const stripGenMarkers = (t: string) => t.replace(/^<!-- gen:(start|end) -->\n?/gm, '').trim();

/** Builds the chunks of every document of an area (genel, flows, modules, usecases). */
export function buildChunks(areaDir: string, opts: ChunkOptions = {}): Chunk[] {
  const files = DOC_DIRS.flatMap(d => walk(path.join(areaDir, d)));
  const out: Chunk[] = [];

  for (const file of files) {
    const rel = path.relative(areaDir, file).split(path.sep).join('/');
    const {meta, body} = parseDoc(fs.readFileSync(file, 'utf8'));
    const top = rel.split('/')[0];
    const kind = top === 'usecases' ? 'usecase' : String(meta.type ?? top);
    const title = String(meta.title ?? meta.name ?? path.basename(file, '.md'));
    const aliases = Array.isArray(meta.aliases) ? (meta.aliases as string[]) : [];
    const area = AREA[top] ?? top;
    const moduleName = meta.module ? ` (${String(meta.module)})` : '';

    let secs = sections(kind === 'usecase' ? manualPart(body).trim() : body);
    if (kind === 'usecase') {
      // Only "Ne yapar" is embedded for cards.
      secs = secs.filter(s => s.headings[0] === 'Ne yapar');
    }

    for (const sec of secs) {
      const pieces = splitLong(stripGenMarkers(stripMermaid(sec.text)));
      pieces.forEach((piece, i) => {
        if (!piece) return;
        const headingPath = sec.headings.join(' › ');
        const crumb = [`${opts.label ? `${opts.label} · ` : ''}${area}${moduleName}`, title, headingPath].filter(Boolean).join(' › ');
        const embed = [crumb, aliases.length ? `Eş anlamlılar: ${aliases.join(', ')}` : '', piece]
          .filter(Boolean).join('\n');
        const id = `${rel}#${headingPath || 'giriş'}${pieces.length > 1 ? `#${i + 1}` : ''}`;
        out.push({
          id,
          hash: createHash('sha256').update(embed).digest('hex'),
          path: rel,
          kind,
          embed_text: embed,
          text: pieces.length > 1 ? piece : sec.text,
          meta: {...meta, headings: sec.headings, title},
        });
      });
    }
  }
  return out;
}

export function writeChunks(chunks: Chunk[], outFile: string): void {
  fs.writeFileSync(outFile, chunks.map(c => JSON.stringify(c)).join('\n') + '\n');
}
