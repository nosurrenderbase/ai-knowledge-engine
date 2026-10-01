/**
 * What the match engine (Go) does with a player's stats, read from its source
 * without compiling it:
 *
 *   DB detailed stat ──(lineup/attr_bridge.go)──▶ ai.Attr field
 *        ──▶ Attr methods / functions that read it (attrFactor gains, style hooks)
 *        ──▶ the places those are called
 *
 * plus the play-style registry (ai/styles.go). The parsing is line-based and
 * relies on gofmt'd code: top-level declarations start at column 0 and end
 * with a "}" line.
 */
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Site {
  file: string;
  line: number;
  /** Enclosing function ("Attr.SpeedFactor", "PlayerBrain.shotExec", "gkSave"). */
  func: string;
}

export interface Gain {
  /** As written: a literal ("0.30") or a constant ("completionGain"). */
  expr: string;
  value: number | null;
  /** First argument of attrFactor, as written. */
  arg: string;
  site: Site;
}

export interface EngineFunc {
  /** "Attr.SpeedFactor", "PlayerBrain.shotExec", "attrFactor". */
  name: string;
  receiver: string | null;
  method: string;
  file: string;
  line: number;
  doc: string;
  /** Attr fields this function reads itself. */
  fields: string[];
  /** Attr methods it calls. */
  calls: string[];
  gains: Gain[];
  hooks: string[];
}

export interface AttrField {
  name: string;
  comment: string;
}

export interface DbStat {
  /** "power.shotPower" (under detailedStats). */
  path: string;
  group: string;
  name: string;
  /** Attr field fed from it, if any. */
  field: string | null;
  /** Card face whose coaching boost is shared onto it ("shooting"), and the share. */
  face: string | null;
  share: number | null;
}

export interface StyleHook {
  name: string;
  comment: string;
  kind: 'exec' | 'tend';
}

export interface PlayStyle {
  name: string;
  effects: {hook: string; tend: boolean; inv: boolean}[];
  note: string;
}

export interface EngineModel {
  commit: string;
  fields: AttrField[];
  dbStats: DbStat[];
  funcs: EngineFunc[];
  /** Attr method name → call sites outside the method itself. */
  callSites: Map<string, Site[]>;
  hooks: StyleHook[];
  styles: PlayStyle[];
  styleConsts: Record<string, number>;
  /** Bridge copies: source field → fields it overwrites, with the condition ("p.IsGoalkeeper()"). */
  aliases: Map<string, {targets: string[]; when: string}>;
  /** Neutral stat value (attrAvg). */
  neutral: number;
}

const ATTR_FILE = 'internal/ai/attr.go';
const BRIDGE_FILE = 'internal/lineup/attr_bridge.go';
const MODELS_FILE = 'internal/models/player.go';
const STYLES_FILE = 'internal/ai/styles.go';
/** Packages whose functions can read player attributes. */
const SIM_DIRS = ['internal/ai', 'internal/match', 'internal/lineup'];

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

function goFiles(dir: string, rel: string): string[] {
  const abs = path.join(dir, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter(f => f.endsWith('.go') && !f.endsWith('_test.go'))
    .sort()
    .map(f => path.posix.join(rel, f));
}

/** Body lines of a struct or const block that starts at `start`. */
function blockAt(lines: string[], start: number): string[] {
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && !/^[)}]/.test(lines[i]); i++) out.push(lines[i]);
  return out;
}

function structBlock(src: string, name: string): string[] {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp(`^type ${name} struct \\{`).test(l));
  return i < 0 ? [] : blockAt(lines, i);
}

/** Numeric constants declared in const blocks or `const x = n` lines. */
export function goConstants(src: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = src.split('\n');
  const take = (l: string) => {
    const m = l.match(/^\s*(?:const\s+)?(\w+)(?:\s+(?:float64|int))?\s*=\s*(-?\d+(?:\.\d+)?)\s*(?:\/\/.*)?$/);
    if (m) out.set(m[1], Number(m[2]));
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^const \($/.test(lines[i])) for (const l of blockAt(lines, i)) take(l);
    else if (/^const \w+/.test(lines[i])) take(lines[i]);
  }
  return out;
}

/** Splits on commas that are not inside parentheses. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The argument list of a call starting right after "name(". */
function callArgs(text: string, from: number): string {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

interface RawFunc {
  receiver: string | null;
  recvVar: string | null;
  method: string;
  file: string;
  line: number;
  doc: string;
  body: string[];
}

function parseFuncs(file: string, src: string): RawFunc[] {
  const lines = src.split('\n');
  const out: RawFunc[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^func (?:\((\w+) \*?(\w+)\) )?(\w+)\(/);
    if (!m) continue;
    let end = i;
    if (!/\{\s*\S.*\}\s*$/.test(lines[i])) while (end + 1 < lines.length && lines[end] !== '}') end++;
    const doc: string[] = [];
    for (let j = i - 1; j >= 0 && lines[j].startsWith('//'); j--) doc.unshift(lines[j].replace(/^\/\/\s?/, ''));
    out.push({recvVar: m[1] ?? null, receiver: m[2] ?? null, method: m[3], file, line: i + 1, doc: doc.join(' ').trim(), body: lines.slice(i, end + 1)});
    i = end;
  }
  return out;
}

const funcName = (f: {receiver: string | null; method: string}) => (f.receiver ? `${f.receiver}.${f.method}` : f.method);

export function buildEngineModel(sourceDir: string): EngineModel {
  const commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {cwd: sourceDir, encoding: 'utf8'}).trim();
  const attrSrc = read(sourceDir, ATTR_FILE);

  // Attr fields and their comments.
  const fields: AttrField[] = [];
  let pending: string[] = [];
  for (const l of structBlock(attrSrc, 'Attr')) {
    const c = l.match(/^\s*\/\/\s?(.*)$/);
    if (c) {
      pending.push(c[1]);
      continue;
    }
    const m = l.match(/^\s*([A-Z]\w*(?:\s*,\s*[A-Z]\w*)*)\s+[\w.[\]*]+\s*(?:\/\/\s?(.*))?$/);
    if (m) {
      for (const name of m[1].split(/\s*,\s*/)) fields.push({name, comment: (m[2] ?? pending.join(' ')).trim()});
    }
    if (!l.trim()) pending = [];
    else if (m) pending = [];
  }
  const fieldSet = new Set(fields.map(f => f.name));

  // Constants of the ai package (gains).
  const consts = new Map<string, number>();
  for (const f of goFiles(sourceDir, 'internal/ai')) for (const [k, v] of goConstants(read(sourceDir, f))) consts.set(k, v);
  const neutral = consts.get('attrAvg') ?? 70;

  // Functions of the simulation packages.
  const raw: RawFunc[] = [];
  const allFiles = SIM_DIRS.flatMap(d => goFiles(sourceDir, d));
  for (const f of allFiles) raw.push(...parseFuncs(f, read(sourceDir, f)));
  const attrMethods = new Set(raw.filter(f => f.receiver === 'Attr').map(f => f.method));

  const funcs: EngineFunc[] = [];
  for (const f of raw) {
    if (f.file === BRIDGE_FILE) continue;
    const text = f.body.join('\n');
    const reads = new Set<string>();
    const calls = new Set<string>();
    // Attr receivers: the method's own receiver, anything named *attr / *Attr, and
    // locals assigned from an Attr method or bound to one (passer, carrier…) are
    // caught through the method calls below.
    const own = f.receiver === 'Attr' && f.recvVar ? `\\b${f.recvVar}` : null;
    const fieldRe = new RegExp(`(?:${own ? own + '|' : ''}\\b\\w*[aA]ttr\\w*(?:\\([^()]*\\))?)\\.([A-Z]\\w*)\\b`, 'g');
    for (const m of text.matchAll(fieldRe)) if (fieldSet.has(m[1])) reads.add(m[1]);
    for (const m of text.matchAll(/\.([A-Za-z]\w*)\(/g)) if (attrMethods.has(m[1]) && !(f.receiver === 'Attr' && m[1] === f.method)) calls.add(m[1]);
    const gains: Gain[] = [];
    for (const m of text.matchAll(/\battrFactor\(/g)) {
      const args = splitArgs(callArgs(text, m.index! + m[0].length));
      if (args.length < 2 || f.method === 'attrFactor') continue;
      const expr = args[1];
      const value = /^-?\d+(\.\d+)?$/.test(expr) ? Number(expr) : (consts.get(expr) ?? null);
      const lineOffset = text.slice(0, m.index).split('\n').length - 1;
      gains.push({expr, value, arg: args[0], site: {file: f.file, line: f.line + lineOffset, func: funcName(f)}});
    }
    const hooks = [...new Set([...text.matchAll(/\b(Hook[A-Z]\w*)\b/g)].map(m => m[1]))];
    if (!reads.size && !calls.size && !gains.length && f.receiver !== 'Attr') continue;
    funcs.push({name: funcName(f), receiver: f.receiver, method: f.method, file: f.file, line: f.line, doc: f.doc, fields: [...reads].sort(), calls: [...calls].sort(), gains, hooks});
  }

  // Call sites of Attr methods (outside the method itself).
  const callSites = new Map<string, Site[]>();
  for (const f of raw) {
    f.body.forEach((l, i) => {
      if (/^\s*\/\//.test(l)) return;
      for (const m of l.matchAll(/\.([A-Za-z]\w*)\(/g)) {
        if (!attrMethods.has(m[1]) || (f.receiver === 'Attr' && f.method === m[1])) continue;
        const list = callSites.get(m[1]) ?? [];
        const site = {file: f.file, line: f.line + i, func: funcName(f)};
        if (!list.some(s => s.file === site.file && s.line === site.line)) list.push(site);
        callSites.set(m[1], list);
      }
    });
  }

  // DB detailed stats and the bridge.
  const modelsSrc = read(sourceDir, MODELS_FILE);
  const groups = structBlock(modelsSrc, 'DetailedStats')
    .map(l => l.match(/^\s*(\w+)\s+(\w+)\s+`bson:"(\w+)"/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => ({goName: m[1], type: m[2], bson: m[3]}));
  const bridgeSrc = read(sourceDir, BRIDGE_FILE);
  const boostVars = new Map<string, string[]>();
  for (const l of bridgeSrc.split('\n')) {
    const m = l.match(/^\s*([\w, ]+?)\s*:=\s*(.*boost\(.*)$/);
    if (!m) continue;
    const names = m[1].split(/\s*,\s*/);
    const rhs = splitArgs(m[2]);
    names.forEach((n, i) => boostVars.set(n, [...(rhs[i] ?? '').matchAll(/boost\("(\w+)"\)/g)].map(x => x[1])));
  }
  const bridged = new Map<string, {field: string; share: number; face: string}>();
  for (const m of bridgeSrc.matchAll(/(\w+):\s*eff\(d\.(\w+)\.(\w+),\s*([\d.]+),\s*([^)]*\)?)\)/g)) {
    const [, field, group, stat, share, boostExpr] = m;
    const face = boostExpr.match(/boost\("(\w+)"\)/)?.[1] ?? (boostVars.get(boostExpr.trim()) ?? []).join(' + ');
    bridged.set(`${group}.${stat}`, {field, share: Number(share), face: face || '—'});
  }
  // Copies such as "a.ShortPassing, a.LongPassing = a.Kicking, a.Kicking" inside an if.
  const aliases = new Map<string, {targets: string[]; when: string}>();
  let cond = '';
  for (const l of bridgeSrc.split('\n')) {
    const c = l.match(/^\s*if (.+?)\s*\{\s*$/);
    if (c) cond = c[1];
    const m = l.match(/^\s*((?:a\.\w+\s*,\s*)*a\.\w+)\s*=\s*((?:a\.\w+\s*,\s*)*a\.\w+)\s*$/);
    if (!m) continue;
    const targets = m[1].split(',').map(x => x.trim().slice(2));
    const sources = m[2].split(',').map(x => x.trim().slice(2));
    sources.forEach((src, i) => {
      const e = aliases.get(src) ?? {targets: [], when: cond.replace(/\s*&&\s*a\.\w+\s*>\s*0/, '')};
      if (!e.targets.includes(targets[i])) e.targets.push(targets[i]);
      aliases.set(src, e);
    });
  }
  const dbStats: DbStat[] = [];
  for (const g of groups) {
    for (const l of structBlock(modelsSrc, g.type)) {
      const m = l.match(/^\s*(\w+)\s+\w+\s+`bson:"(\w+)"/);
      if (!m) continue;
      const b = bridged.get(`${g.goName}.${m[1]}`);
      dbStats.push({
        path: `${g.bson}.${m[2]}`,
        group: g.bson,
        name: m[2],
        field: b?.field ?? null,
        face: b && b.share > 0 ? b.face : null,
        share: b && b.share > 0 ? b.share : null,
      });
    }
  }

  // Play styles.
  const stylesSrc = fs.existsSync(path.join(sourceDir, STYLES_FILE)) ? read(sourceDir, STYLES_FILE) : '';
  const hooks: StyleHook[] = [];
  for (const l of stylesSrc.split('\n')) {
    const m = l.match(/^\s*(Hook[A-Z]\w*)\b[^/]*(?:\/\/\s?(.*))?$/);
    if (m && !l.includes('{') && !l.includes(':')) hooks.push({name: m[1], comment: (m[2] ?? '').trim(), kind: m[1].startsWith('HookTend') ? 'tend' : 'exec'});
  }
  const styles: PlayStyle[] = [];
  for (const m of stylesSrc.matchAll(/^[ \t]*"([^"]+)":[ \t]*\{(.*)\},[ \t]*(?:\/\/[ \t]?(.*))?$/gm)) {
    const effects = [...m[2].matchAll(/\{hook: (Hook\w+)([^}]*)\}/g)].map(e => ({hook: e[1], tend: /tend: true/.test(e[2]), inv: /inv: true/.test(e[2])}));
    styles.push({name: m[1], effects, note: (m[3] ?? '').trim()});
  }
  const styleConsts: Record<string, number> = {};
  for (const [k, v] of goConstants(stylesSrc)) if (k.startsWith('style')) styleConsts[k] = v;

  return {commit, fields, dbStats, funcs, callSites, hooks, styles, styleConsts, aliases, neutral};
}

/**
 * Attr methods that list whole groups of stats (engineStats, gkStats): they feed
 * the squad-average bookkeeping, not a single behaviour, so they are reported
 * once per stat ("takım ortalamasına girer") instead of as users.
 */
export function isPoolFunc(f: EngineFunc): boolean {
  return f.receiver === 'Attr' && f.fields.length >= 5 && f.gains.length === 0 && f.calls.length === 0;
}

/** Whether a field is part of the squad-average pool (fixture-local recentering). */
export function inPool(model: EngineModel, field: string): boolean {
  return model.funcs.some(f => isPoolFunc(f) && f.fields.includes(field));
}

/** Attr fields a function depends on, directly or through the Attr methods it calls (pool lists excluded). */
export function fieldsOf(model: EngineModel, name: string, seen = new Set<string>()): Set<string> {
  const f = model.funcs.find(x => x.name === name);
  const out = new Set<string>();
  if (!f || seen.has(name) || isPoolFunc(f)) return out;
  seen.add(name);
  for (const x of f.fields) out.add(x);
  for (const c of f.calls) for (const x of fieldsOf(model, `Attr.${c}`, seen)) out.add(x);
  return out;
}

/** Functions that use a field: directly (via empty), or through the Attr methods listed in via. */
export function usersOf(model: EngineModel, field: string): {func: EngineFunc; via: string[]}[] {
  const out: {func: EngineFunc; via: string[]}[] = [];
  for (const f of model.funcs) {
    if (isPoolFunc(f)) continue;
    if (f.fields.includes(field)) out.push({func: f, via: []});
    else {
      const via = f.calls.filter(c => fieldsOf(model, `Attr.${c}`).has(field));
      if (via.length) out.push({func: f, via});
    }
  }
  return out;
}

/** attrFactor at a stat value: 1 + gain·(stat − neutral)/30, clamped to 1 ± gain. */
export function factorAt(gain: number, stat: number, neutral = 70): number {
  const f = 1 + (gain * (stat - neutral)) / 30;
  return Math.max(1 - gain, Math.min(1 + gain, f));
}

export const statSlug = (path: string) =>
  path
    .split('.')
    .pop()!
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

export {lowerFirst};
