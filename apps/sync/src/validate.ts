import * as fs from 'node:fs';
import * as path from 'node:path';
import {buildChunks, FrontmatterError, genBlock, loadDocs, manualPart, parseDoc, stringList} from '@ai-knowledge-engine/kb';
import {graphqlOperations, restRoutes} from './endpoints.ts';
import type {Git} from './git.ts';
import {cardPath, isUsecaseFile, moduleOf} from './impact.ts';
import {findSecrets} from './secrets.ts';

export const STATUSES = [
  'canlıda',
  'kısmen canlıda',
  "kod main'de, istemci bağlı değil",
  'istemci kullanımı belirsiz',
  'bayrakla kapalı',
  'kaldırıldı',
];

/** Area-root documents the worker maintains itself; the agent must not touch them. */
const META_DOCS = new Set(['README.md']);

/** Code identifiers worth checking: CONSTANT_CASE names and Nest class names. */
const IDENTIFIER =
  /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*(?:UseCase|Error|Guard|Service|Resolver|Controller|Repository|Module|Schema))$/;

/** Lines that talk about the past may quote names that no longer exist. */
const HISTORICAL = /kaldır|eski|önceki|geçmiş|artık yok/i;

export interface ValidationInput {
  kbGit: Git;
  codeGit: Git;
  area: string;
  /** Code commit the worktree is checked out at. */
  head: string;
  /** Card generated blocks right after the generator ran (repo-relative paths). */
  genBlocks: Map<string, string | null>;
  cardModules: string[];
  /** Resolver/controller files added or modified by the job. */
  endpointFiles: string[];
  /** Cards the generator changed (repo-relative); they do not count towards the size brake. */
  regeneratedCards: string[];
  impactCount: number;
}

export interface ValidationResult {
  /** Problems the agent can fix; sent back to it. */
  retryable: string[];
  /** Problems that stop the job (secrets, forbidden files, runaway diffs). */
  fatal: string[];
  /** Changed markdown files (repo-relative). */
  changed: string[];
}

/** Lines of `after` that are not in `before` (as a multiset). */
export function addedLines(before: string | null, after: string): string[] {
  const pool = new Map<string, number>();
  for (const line of (before ?? '').split('\n')) pool.set(line, (pool.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after.split('\n')) {
    const n = pool.get(line) ?? 0;
    if (n > 0) pool.set(line, n - 1);
    else added.push(line);
  }
  return added;
}

export function markdownLinks(text: string): string[] {
  const links: string[] = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    links.push(decodeURIComponent(target.replace(/[#?].*$/, '')));
  }
  return links;
}

export function backtickIdentifiers(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim();
    if (IDENTIFIER.test(token)) out.push(token);
  }
  return out;
}

async function codeIdentifiers(codeGit: Git, head: string): Promise<Set<string>> {
  const out = await codeGit.tryRun(['grep', '-h', '-o', '-I', '-E', '[A-Za-z_][A-Za-z0-9_]{2,}', head, '--', '.', ':!*.md']);
  return new Set((out ?? '').split('\n').map(l => l.replace(/^[^:]*:/, '')));
}

function checkChunks(areaDir: string): string[] {
  let chunks;
  try {
    chunks = buildChunks(areaDir);
  } catch (e) {
    return [`parçalama başarısız: ${(e as Error).message}`];
  }
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const chunk of chunks) {
    if (ids.has(chunk.id)) errors.push(`tekrar eden parça id'si (aynı başlık iki kez): ${chunk.id}`);
    ids.add(chunk.id);
    if (chunk.embed_text.includes('```mermaid')) errors.push(`embed_text içinde Mermaid kaldı: ${chunk.id}`);
  }
  return errors;
}

export async function validate(input: ValidationInput): Promise<ValidationResult> {
  const {kbGit, codeGit, area} = input;
  const kbRoot = kbGit.cwd;
  const areaDir = path.join(kbRoot, area);
  const retryable: string[] = [];
  const fatal: string[] = [];

  for (const file of await kbGit.changedFiles('.')) {
    const inArea = file.startsWith(`${area}/`);
    if (!inArea || !file.endsWith('.md')) {
      fatal.push(`izin verilmeyen dosya değişti: ${file}`);
    } else if (META_DOCS.has(file.slice(area.length + 1))) {
      fatal.push(`işçinin yönettiği doküman değişti: ${file}`);
    }
  }
  for (const file of await kbGit.deletedFiles('.')) fatal.push(`dosya silindi (silmek yerine "kaldırıldı" işaretlenmeli): ${file}`);
  for (const file of await codeGit.changedFiles('.')) fatal.push(`kod reposunda dosya değişti (salt okunur olmalı): ${file}`);

  const changed = (await kbGit.changedFiles(area)).filter(f => f.endsWith('.md') && fs.existsSync(path.join(kbRoot, f)));
  const codeFiles = new Set((await codeGit.run(['ls-tree', '-r', '--name-only', input.head])).split('\n').filter(Boolean));
  const toCheck: {file: string; lines: string[]}[] = [];
  const regenerated = new Set(input.regeneratedCards);
  let editedDocs = 0;

  for (const file of changed) {
    const rel = file.slice(area.length + 1);
    const text = fs.readFileSync(path.join(kbRoot, file), 'utf8');
    const before = await kbGit.show('HEAD', file);
    const isCard = rel.startsWith('usecases/');

    let meta: Record<string, unknown> = {};
    try {
      meta = parseDoc(text).meta;
    } catch (e) {
      if (e instanceof FrontmatterError) retryable.push(`${rel}: frontmatter geçerli YAML değil (${e.message})`);
      else throw e;
    }
    if (meta.status !== undefined && !STATUSES.includes(String(meta.status))) {
      retryable.push(`${rel}: status "${String(meta.status)}" izinli değil (${STATUSES.join(' | ')})`);
    }
    if (meta.aliases !== undefined && !Array.isArray(meta.aliases)) retryable.push(`${rel}: aliases bir liste olmalı`);

    for (const link of markdownLinks(text)) {
      if (!fs.existsSync(path.resolve(path.dirname(path.join(kbRoot, file)), link))) {
        retryable.push(`${rel}: kırık link ${link}`);
      }
    }
    if (meta.status !== 'kaldırıldı') {
      for (const src of stringList(meta.sources)) {
        if (!codeFiles.has(src)) retryable.push(`${rel}: sources içindeki ${src} kodda yok`);
      }
    }
    for (const r of stringList(meta.related)) {
      if (!fs.existsSync(path.join(areaDir, r))) retryable.push(`${rel}: related içindeki ${r} yok`);
    }
    if (text.includes('_TODO:')) retryable.push(`${rel}: _TODO: kalmış`);

    if (isCard) {
      if (!input.genBlocks.has(file)) {
        retryable.push(`${rel}: kartı yalnız script üretir; bu dosyayı oluşturma`);
      } else if (input.genBlocks.get(file) !== genBlock(text)) {
        retryable.push(`${rel}: <!-- gen:start --> … <!-- gen:end --> arası değiştirilmiş; oraya dokunma`);
      }
    }

    const lines = addedLines(before === null ? null : isCard ? manualPart(before) : before, isCard ? manualPart(text) : text);
    const touchedByAgent = !(isCard && regenerated.has(file) && lines.every(l => !l.trim()));
    if (touchedByAgent) editedDocs++;
    toCheck.push({file: rel, lines});

    for (const line of addedLines(before, text)) {
      const hits = findSecrets(line);
      if (hits.length) fatal.push(`${rel}: gizli bilgi şüphesi (${hits.join(', ')})`);
    }
  }

  const tokens = toCheck.flatMap(({file, lines}) =>
    lines.filter(l => !HISTORICAL.test(l)).flatMap(l => backtickIdentifiers(l).map(t => ({file, t}))),
  );
  if (tokens.length) {
    const known = await codeIdentifiers(codeGit, input.head);
    for (const {file, t} of tokens) {
      if (!known.has(t)) retryable.push(`${file}: \`${t}\` kodda bulunamadı`);
    }
  }

  // Coverage: every use case of a regenerated module has a card, every changed endpoint is documented.
  for (const module of input.cardModules) {
    for (const f of codeFiles) {
      if (!isUsecaseFile(f) || moduleOf(f) !== module) continue;
      const src = fs.readFileSync(path.join(codeGit.cwd, f), 'utf8');
      if (!/\bclass\s+\w+/.test(src)) continue;
      if (!fs.existsSync(path.join(areaDir, cardPath(f)))) retryable.push(`${cardPath(f)}: ${f} için kart yok`);
    }
  }
  if (input.endpointFiles.length) {
    const corpus = loadDocs(areaDir).map(d => d.body).join('\n');
    for (const f of input.endpointFiles) {
      const src = fs.readFileSync(path.join(codeGit.cwd, f), 'utf8');
      for (const op of graphqlOperations(src)) {
        if (!new RegExp(`\\b${op}\\b`).test(corpus)) retryable.push(`GraphQL işlemi \`${op}\` (${f}) hiçbir dokümanda geçmiyor`);
      }
      for (const route of restRoutes(src)) {
        if (!corpus.includes(route.slice(1))) retryable.push(`REST ucu \`${route}\` (${f}) hiçbir dokümanda geçmiyor`);
      }
    }
  }

  retryable.push(...checkChunks(areaDir));

  const limit = Math.max(10, input.impactCount * 3);
  if (editedDocs > limit) fatal.push(`beklenmedik büyüklükte değişiklik: ${editedDocs} doküman (etki listesi ${input.impactCount}); insan onayı gerekli`);

  return {retryable: [...new Set(retryable)], fatal: [...new Set(fatal)], changed};
}
