/**
 * A model of the React Native (Expo Router) app, read from source without
 * type checking: GraphQL operations and the backend fields they call, the
 * import graph, which files the routes reach, where each operation is used,
 * navigation targets and analytics events. Deterministic; no AI.
 */
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {Node, Project, SyntaxKind, type SourceFile} from 'ts-morph';

export type OperationKind = 'query' | 'mutation' | 'subscription';

export interface GqlOperation {
  name: string;
  kind: OperationKind;
  /** Top-level fields of the operation: the backend Query/Mutation fields it calls. */
  rootFields: string[];
  /** Variable definitions as written, e.g. "$bossName: String!". */
  variables: string;
  document: string;
  /** Repo-relative file the operation is defined in. */
  file: string;
  /** Name of the constant holding it; null for documents not bound to a constant. */
  constName: string | null;
  exported: boolean;
  /** graphql() (codegen) or gql`` (raw). */
  style: 'codegen' | 'raw';
}

export interface FileInfo {
  path: string;
  /** Resolved in-repo imports (and re-exports): target file and the names taken from it. */
  imports: {target: string; names: string[]; reexport?: boolean}[];
  /** Re-exports: exported name (or '*'), the name in the target, and the target file. */
  reexports: {name: string; source: string; target: string}[];
  /** Names the file itself declares as exports ('default' included). */
  exportNames: Set<string>;
  navTargets: string[];
  events: string[];
}

export interface FrontendModel {
  commit: string;
  files: Map<string, FileInfo>;
  ops: GqlOperation[];
  /** Route files (app/**), layouts included. */
  routes: string[];
  /** Files reachable from any route through imports. */
  reachable: Set<string>;
  /** Operation key (file#name) → files that use it. */
  opUsers: Map<string, string[]>;
  /** File → files importing it. */
  importers: Map<string, Set<string>>;
}

export const opKey = (op: Pick<GqlOperation, 'file' | 'name'>) => `${op.file}#${op.name}`;

const isLayout = (route: string) => /(^|\/)_layout\.tsx?$/.test(route);

/** Expo Router path of a route file: app/(tabs)/index.tsx → "/", app/buildings/[id].tsx → "/buildings/[id]". */
export function routePath(file: string): string {
  const parts = file
    .replace(/^app\//, '')
    .replace(/\.(tsx?|jsx?)$/, '')
    .split('/')
    .filter(p => !/^\(.*\)$/.test(p));
  if (parts.at(-1) === 'index') parts.pop();
  if (parts.at(-1) === '_layout') {
    // Layouts are not screens: name them after their folder, groups included.
    const dir = path.posix.dirname(file).replace(/^app\/?/, '');
    return dir ? `${dir} düzeni` : 'kök düzen';
  }
  return `/${parts.join('/')}`;
}

/** Parses an operation document: kind, name, variables and its top-level fields. */
export function parseOperation(doc: string): Pick<GqlOperation, 'kind' | 'name' | 'variables' | 'rootFields'> | null {
  const m = /\b(query|mutation|subscription)\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*\{/.exec(doc);
  if (!m) return null;
  const rootFields: string[] = [];
  let depth = 0;
  let parens = 0;
  let i = m.index + m[0].length - 1;
  for (; i < doc.length; i++) {
    const c = doc[i];
    if (c === '#') {
      while (i < doc.length && doc[i] !== '\n') i++;
      continue;
    }
    if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (parens === 0 && c === '{') depth++;
    else if (parens === 0 && c === '}') {
      if (--depth === 0) break;
    } else if (depth === 1 && parens === 0 && /[A-Za-z_]/.test(c) && !/[\w.]/.test(doc[i - 1] ?? '')) {
      const word = /^[A-Za-z_]\w*/.exec(doc.slice(i))![0];
      const after = doc.slice(i + word.length).match(/^\s*(:)?\s*([A-Za-z_]\w*)?/)!;
      const field = after[1] && after[2] ? after[2] : word;
      if (field !== '__typename' && !rootFields.includes(field)) rootFields.push(field);
      i += (after[1] && after[2] ? word.length + after[0].length : word.length) - 1;
    }
  }
  return {kind: m[1] as OperationKind, name: m[2], variables: (m[3] ?? '').replace(/\s+/g, ' ').trim(), rootFields};
}

function templateText(node: Node): string | null {
  if (Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  if (Node.isTemplateExpression(node)) return node.getText().slice(1, -1);
  return null;
}

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(root, rel), {withFileTypes: true})) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__tests__' || r === 'src/gql') continue;
        walk(r);
      } else if (/\.(tsx?)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
        out.push(r);
      }
    }
  };
  for (const dir of ['app', 'src']) if (fs.existsSync(path.join(root, dir))) walk(dir);
  return out.sort();
}

export function buildFrontendModel(sourceDir: string): FrontendModel {
  const commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {cwd: sourceDir, encoding: 'utf8'}).trim();
  const relFiles = listSourceFiles(sourceDir);
  const known = new Set(relFiles);
  const project = new Project({useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true, compilerOptions: {allowJs: false, jsx: 4}});

  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/assets/')) return null;
    if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    else return null;
    // "./" and "." name the folder itself (its index file).
    base = base.replace(/\/+$/, '');
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (known.has(c)) return c;
    return null;
  };

  const files = new Map<string, FileInfo>();
  const ops: GqlOperation[] = [];
  const sources = new Map<string, SourceFile>();

  for (const rel of relFiles) {
    const sf = project.addSourceFileAtPath(path.join(sourceDir, rel));
    sources.set(rel, sf);
    const info: FileInfo = {path: rel, imports: [], reexports: [], exportNames: new Set(), navTargets: [], events: []};

    for (const imp of sf.getImportDeclarations()) {
      const target = resolve(rel, imp.getModuleSpecifierValue());
      if (!target) continue;
      const names = imp.getNamedImports().map(n => n.getName());
      if (imp.getDefaultImport()) names.push('default');
      if (imp.getNamespaceImport()) names.push('*');
      info.imports.push({target, names});
    }
    for (const exp of sf.getExportDeclarations()) {
      const spec = exp.getModuleSpecifierValue();
      if (!spec) continue;
      const target = resolve(rel, spec);
      if (!target) continue;
      const named = exp.getNamedExports();
      info.imports.push({target, names: named.length ? named.map(n => n.getName()) : ['*'], reexport: true});
      if (named.length === 0) info.reexports.push({name: '*', source: '*', target});
      for (const n of named) info.reexports.push({name: n.getAliasNode()?.getText() ?? n.getName(), source: n.getName(), target});
    }
    // What the file itself exports (syntax only; enough to follow barrels by name).
    for (const stmt of sf.getStatements()) {
      if (Node.isExportAssignment(stmt)) info.exportNames.add('default');
      if (Node.isExportDeclaration(stmt) && !stmt.getModuleSpecifierValue()) {
        for (const n of stmt.getNamedExports()) info.exportNames.add(n.getAliasNode()?.getText() ?? n.getName());
      }
      if (!Node.isModifierable(stmt) || !stmt.hasModifier(SyntaxKind.ExportKeyword)) continue;
      if (stmt.hasModifier(SyntaxKind.DefaultKeyword)) info.exportNames.add('default');
      if (Node.isVariableStatement(stmt)) for (const d of stmt.getDeclarations()) info.exportNames.add(d.getName());
      else if (Node.hasName(stmt)) info.exportNames.add(stmt.getName());
    }
    // Lazy imports: import('@/x') and require('@/x').
    sf.forEachDescendant(node => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText();
      if (callee !== 'import' && callee !== 'require') return;
      const arg = node.getArguments()[0];
      if (!arg || !Node.isStringLiteral(arg)) return;
      const target = resolve(rel, arg.getLiteralValue());
      if (target) info.imports.push({target, names: ['*']});
    });

    const text = sf.getFullText();
    for (const m of text.matchAll(/router\.(?:push|replace|navigate|dismissTo)\(\s*['"`](\/[^'"`$]*)/g)) info.navTargets.push(m[1]);
    for (const m of text.matchAll(/(?:href|pathname)\s*[=:]\s*\{?\s*['"`](\/[^'"`$]*)/g)) info.navTargets.push(m[1]);
    for (const m of text.matchAll(/\btrack\(\s*['"]([a-z0-9_]+)['"]/g)) info.events.push(m[1]);
    info.navTargets = [...new Set(info.navTargets)].sort();
    info.events = [...new Set(info.events)].sort();

    // GraphQL documents: graphql(`…`) (codegen) and gql`…` (raw).
    sf.forEachDescendant(node => {
      let doc: string | null = null;
      let style: GqlOperation['style'] = 'codegen';
      if (Node.isCallExpression(node) && node.getExpression().getText() === 'graphql') {
        const arg = node.getArguments()[0];
        doc = arg ? templateText(arg) : null;
      } else if (Node.isTaggedTemplateExpression(node) && node.getTag().getText() === 'gql') {
        doc = templateText(node.getTemplate());
        style = 'raw';
      }
      if (!doc) return;
      const parsed = parseOperation(doc);
      if (!parsed) return;
      const decl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const constName = decl?.getName() ?? null;
      const exported = Boolean(decl?.getVariableStatement()?.isExported());
      ops.push({...parsed, document: doc.trim(), file: rel, constName, exported, style});
    });
    files.set(rel, info);
  }

  const importers = new Map<string, Set<string>>();
  for (const f of files.values()) {
    for (const imp of f.imports) {
      if (!importers.has(imp.target)) importers.set(imp.target, new Set());
      importers.get(imp.target)!.add(f.path);
    }
  }

  const routes = relFiles.filter(f => f.startsWith('app/'));
  // Files that actually provide `name` when it is imported from `file`, through barrels.
  const providers = (file: string, name: string, seen = new Set<string>()): string[] => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const info = files.get(file);
    if (!info) return [];
    if (name === '*') return [file, ...info.reexports.flatMap(r => providers(r.target, r.source === '*' ? '*' : r.source, seen))];
    if (info.exportNames.has(name)) return [file];
    const out: string[] = [];
    for (const r of info.reexports) {
      if (r.name === name) out.push(...providers(r.target, r.source, seen));
      else if (r.name === '*') out.push(...providers(r.target, name, seen));
    }
    return out;
  };

  // Reachable files: follow imports from the routes; a barrel passes on only the names taken from it.
  const reachable = new Set<string>();
  const queue = [...routes];
  const visit = (f: string) => {
    if (!reachable.has(f)) {
      reachable.add(f);
      queue.push(f);
    }
  };
  for (const r of routes) reachable.add(r);
  while (queue.length) {
    const f = queue.pop()!;
    for (const imp of files.get(f)?.imports ?? []) {
      if (imp.reexport) continue;
      visit(imp.target);
      for (const name of imp.names) for (const p of providers(imp.target, name)) visit(p);
    }
  }

  // Which constant a (file, imported name) pair ends up at, following re-exports.
  const opsByConst = new Map<string, GqlOperation>();
  for (const op of ops) if (op.constName) opsByConst.set(`${op.file}#${op.constName}`, op);
  const origin = (file: string, name: string, seen = new Set<string>()): GqlOperation | null => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (opsByConst.has(key)) return opsByConst.get(key)!;
    for (const r of files.get(file)?.reexports ?? []) {
      if (r.name === name || r.name === '*') {
        const found = origin(r.target, r.name === '*' ? name : r.source, seen);
        if (found) return found;
      }
    }
    return null;
  };

  const opUsers = new Map<string, Set<string>>();
  const addUser = (op: GqlOperation, user: string) => {
    if (!opUsers.has(opKey(op))) opUsers.set(opKey(op), new Set());
    opUsers.get(opKey(op))!.add(user);
  };
  for (const f of files.values()) {
    for (const imp of f.imports) {
      // Passing an operation on (a barrel file) is not using it.
      if (imp.reexport) continue;
      for (const name of imp.names) {
        if (name === '*') {
          for (const op of ops) if (op.file === imp.target && op.exported) addUser(op, f.path);
          continue;
        }
        const op = origin(imp.target, name);
        if (op) addUser(op, f.path);
      }
    }
  }
  // Used inside its own file (a hook next to its document, or an unexported raw query).
  for (const op of ops) {
    if (!op.constName) {
      addUser(op, op.file);
      continue;
    }
    const uses = sources.get(op.file)!.getFullText().match(new RegExp(`\\b${op.constName}\\b`, 'g'))?.length ?? 0;
    if (uses > 1) addUser(op, op.file);
  }

  return {
    commit,
    files,
    ops,
    routes,
    reachable,
    importers,
    opUsers: new Map([...opUsers.entries()].map(([k, v]) => [k, [...v].sort()])),
  };
}

/** Routes whose import tree contains `file`, screens before layouts. */
export function routesReaching(model: FrontendModel, file: string): string[] {
  const found = new Set<string>();
  const seen = new Set<string>([file]);
  const queue = [file];
  while (queue.length) {
    const f = queue.pop()!;
    if (f.startsWith('app/')) found.add(f);
    for (const imp of model.importers.get(f) ?? []) {
      if (!seen.has(imp)) {
        seen.add(imp);
        queue.push(imp);
      }
    }
  }
  const all = [...found].sort();
  const screens = all.filter(r => !isLayout(r));
  return screens.length ? screens : all;
}

/** Files a route pulls in (its import tree), without descending into other routes. */
export function routeClosure(model: FrontendModel, route: string): Set<string> {
  const out = new Set<string>([route]);
  const queue = [route];
  while (queue.length) {
    const f = queue.pop()!;
    for (const imp of model.files.get(f)?.imports ?? []) {
      if (out.has(imp.target) || imp.target.startsWith('app/')) continue;
      out.add(imp.target);
      queue.push(imp.target);
    }
  }
  return out;
}
