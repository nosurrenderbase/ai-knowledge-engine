import * as fs from 'node:fs';
import * as path from 'node:path';
import {parse as parseYaml} from 'yaml';

export interface KbDoc {
  /** Path relative to the area directory, e.g. "flows/pvp/gunluk-hak.md". */
  path: string;
  meta: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

export class FrontmatterError extends Error {}

/** Splits a markdown file into its YAML frontmatter and body. Throws FrontmatterError on invalid YAML. */
export function parseDoc(text: string): {meta: Record<string, unknown>; body: string} {
  const m = FRONTMATTER.exec(text);
  if (!m) return {meta: {}, body: text};
  let meta: unknown;
  try {
    meta = parseYaml(m[1]);
  } catch (e) {
    throw new FrontmatterError((e as Error).message);
  }
  if (meta === null || meta === undefined) meta = {};
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    throw new FrontmatterError('frontmatter bir nesne değil');
  }
  return {meta: meta as Record<string, unknown>, body: text.slice(m[0].length)};
}

/** Directories inside an area that hold tooling, not documents. */
const SKIP_DIRS = new Set(['node_modules', 'tools', '.git']);

export function listMarkdown(areaDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.md')) {
        out.push(path.relative(areaDir, path.join(dir, entry.name)).split(path.sep).join('/'));
      }
    }
  };
  walk(areaDir);
  return out.sort();
}

/** Loads every document of an area. Documents with broken frontmatter are loaded with empty meta. */
export function loadDocs(areaDir: string): KbDoc[] {
  return listMarkdown(areaDir).map(rel => {
    const text = fs.readFileSync(path.join(areaDir, rel), 'utf8');
    try {
      const {meta, body} = parseDoc(text);
      return {path: rel, meta, body};
    } catch {
      return {path: rel, meta: {}, body: text};
    }
  });
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
