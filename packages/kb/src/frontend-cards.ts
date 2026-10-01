/**
 * Generated documents of the frontend knowledge base (no AI):
 *   api/<operation>.md          one per GraphQL operation: backend fields, users, screens
 *   ekranlar/<route>.md         one per route: operations, navigation, analytics it pulls in
 *   genel/api-haritasi.md       backend field → frontend operations → screens, and the gaps
 *   genel/kullanilmayan-kod.md  files no route reaches, operations nobody uses
 * Each keeps a written part above its generated block (see writeCard).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {writeCard} from './cards.ts';
import {loadDocs, type KbDoc} from './docs.ts';
import {graphqlOperationDetails, type GraphqlOperation} from './endpoints.ts';
import {buildFrontendModel, opKey, routeClosure, routePath, routesReaching, type FrontendModel, type GqlOperation} from './frontend-model.ts';

export interface FrontendDocsOptions {
  /** Knowledge base area for the app (e.g. <kb>/frontend). */
  areaDir: string;
  /** App repo (React Native), checked out at the commit to document. */
  sourceDir: string;
  /** Backend repo, for which Query/Mutation fields exist. */
  backendDir: string;
  /** Backend knowledge base area, for links to the documents about a field. */
  backendAreaDir: string;
}

const GENERATOR = 'ai-knowledge-engine/packages/kb (frontend)';

export const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

/** ekranlar/ file name of a route: app/(tabs)/index.tsx → tabs-index, app/buildings/[id].tsx → buildings-id. */
export const routeSlug = (route: string) =>
  route
    .replace(/^app\//, '')
    .replace(/\.(tsx?|jsx?)$/, '')
    .replace(/[()[\]]/g, '')
    .split('/')
    .map(kebab)
    .join('-')
    .replace(/^_layout$/, 'kok-duzen');

const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function backendFields(backendDir: string): Map<string, GraphqlOperation['kind']> {
  const fields = new Map<string, GraphqlOperation['kind']>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (/\.resolver\.ts$/.test(e.name)) {
        for (const op of graphqlOperationDetails(fs.readFileSync(p, 'utf8'))) fields.set(op.name, op.kind);
      }
    }
  };
  walk(path.join(backendDir, 'src'));
  return fields;
}

/** Backend documents that name a field in backticks, flows and modules first. */
function backendDocsFor(docs: KbDoc[]): (field: string) => KbDoc[] {
  const rank = (d: KbDoc) => (d.path.startsWith('flows/') ? 0 : d.path.startsWith('modules/') ? 1 : d.path.startsWith('genel/') ? 2 : 3);
  const sorted = [...docs].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  const cache = new Map<string, KbDoc[]>();
  return field => {
    if (!cache.has(field)) {
      const needle = `\`${field}\``;
      cache.set(field, sorted.filter(d => d.meta.status !== 'kaldırıldı' && d.body.includes(needle)).slice(0, 6));
    }
    return cache.get(field)!;
  };
}

type Usage = 'aktif' | 'erişilmiyor' | 'kullanılmıyor';

function usageOf(model: FrontendModel, op: GqlOperation): Usage {
  const users = model.opUsers.get(opKey(op)) ?? [];
  if (users.length === 0) return 'kullanılmıyor';
  return users.some(u => model.reachable.has(u)) ? 'aktif' : 'erişilmiyor';
}

const USAGE_TEXT: Record<Usage, string> = {
  aktif: 'kullanılıyor (en az bir ekrandan erişiliyor)',
  erişilmiyor: 'kullanan kod var ama hiçbir ekrandan erişilmiyor (ölü kod)',
  kullanılmıyor: 'tanımlı ama hiçbir yerde kullanılmıyor',
};

const routeLink = (r: string, fromDir: 'api' | 'genel' | 'ekranlar') => {
  const target = `${routeSlug(r)}.md`;
  return `[${routePath(r)}](${fromDir === 'ekranlar' ? '' : '../ekranlar/'}${target})`;
};

function renderOperation(model: FrontendModel, op: GqlOperation, backend: Map<string, string>, docsFor: (f: string) => KbDoc[]): string {
  const users = model.opUsers.get(opKey(op)) ?? [];
  const usage = usageOf(model, op);
  const out: string[] = [];
  out.push(`# ${op.name} (${op.kind})`, '');
  out.push(`- **Tanım:** ${code(op.file)}${op.constName ? ` (${code(op.constName)})` : ''}`);
  out.push(`- **Biçim:** ${op.style === 'codegen' ? 'codegen `graphql()` (tipli)' : 'ham `gql` (codegen dışı)'}`);
  out.push(`- **Kullanım:** ${USAGE_TEXT[usage]}`);
  const missing = op.rootFields.filter(f => !backend.has(f));
  out.push(`- **Backend alanları:** ${op.rootFields.map(f => `${code(f)}${backend.has(f) ? '' : ' **(backend\'de yok)**'}`).join(', ')}`);
  out.push('');

  out.push('## Backend tarafı', '', '| Alan | Backend\'de | İlgili backend dokümanları |', '|---|---|---|');
  for (const f of op.rootFields) {
    const docs = docsFor(f).map(d => `[${cell(String(d.meta.title ?? d.meta.name ?? d.path))}](../../backend/${d.path})`);
    out.push(`| ${code(f)} | ${backend.has(f) ? `var (${backend.get(f)})` : '**yok**'} | ${docs.join('<br>') || '-'} |`);
  }
  if (missing.length) out.push('', `Backend'de bulunmayan alan(lar): ${missing.map(code).join(', ')}. İstek bu alanlar için hata döner ya da istemci bu çağrıyı yapmıyordur; kodu kontrol edin.`);
  out.push('');

  out.push('## Kullanan dosyalar ve ekranlar', '');
  if (users.length === 0) out.push('_Hiçbir dosya bu işlemi kullanmıyor._');
  else {
    out.push('| Dosya | Erişildiği ekranlar |', '|---|---|');
    for (const u of users) {
      const routes = model.reachable.has(u) ? routesReaching(model, u) : [];
      out.push(`| ${code(u)} | ${routes.length ? routes.map(r => routeLink(r, 'api')).join(', ') : '_erişilmiyor_'} |`);
    }
  }
  out.push('');
  if (op.variables) out.push('## Değişkenler', '', code(op.variables), '');
  out.push('## GraphQL belgesi', '', '```graphql', op.document, '```', '');
  return out.join('\n');
}

function renderRoute(model: FrontendModel, route: string, opsByUser: Map<string, GqlOperation[]>): string {
  const closure = routeClosure(model, route);
  const out: string[] = [];
  out.push(`# ${routePath(route)}`, '');
  out.push(`- **Dosya:** ${code(route)}`);
  const ops = [...closure].flatMap(f => (opsByUser.get(f) ?? []).map(op => ({op, via: f})));
  const uniqueOps = new Map<string, {op: GqlOperation; via: string[]}>();
  for (const {op, via} of ops) {
    const e = uniqueOps.get(opKey(op)) ?? {op, via: []};
    e.via.push(via);
    uniqueOps.set(opKey(op), e);
  }
  out.push(`- **Çektiği dosya sayısı:** ${closure.size} (bu ekranın import ağacı, diğer rotalar hariç)`);
  out.push(`- **Erişebildiği GraphQL işlemi:** ${uniqueOps.size}`, '');

  out.push('## GraphQL işlemleri', '');
  if (uniqueOps.size === 0) out.push('_Yok._');
  else {
    out.push('| İşlem | Tür | Backend alanları | Kullanan dosya(lar) |', '|---|---|---|---|');
    for (const {op, via} of [...uniqueOps.values()].sort((a, b) => a.op.name.localeCompare(b.op.name))) {
      out.push(`| [${op.name}](../api/${kebab(op.name)}.md) | ${op.kind} | ${op.rootFields.map(code).join(', ')} | ${[...new Set(via)].sort().map(code).join('<br>')} |`);
    }
  }
  out.push('');
  const nav = [...new Set([...closure].flatMap(f => model.files.get(f)?.navTargets ?? []))].sort();
  out.push('## Yönlendirdiği rotalar', '', nav.length ? nav.map(code).join(', ') : '_Kod içinde sabit rota yönlendirmesi yok._', '');
  const events = [...new Set([...closure].flatMap(f => model.files.get(f)?.events ?? []))].sort();
  out.push('## Gönderebildiği analitik olaylar', '', events.length ? events.map(code).join(', ') : '_Yok._', '');
  const direct = (model.files.get(route)?.imports ?? []).map(i => i.target).filter(t => t.startsWith('src/components/') || t.startsWith('src/widgets/'));
  out.push('## Doğrudan kullandığı bileşenler', '', direct.length ? [...new Set(direct)].sort().map(d => `- ${code(d)}`).join('\n') : '_Yok._', '');
  return out.join('\n');
}

function renderApiMap(model: FrontendModel, backend: Map<string, GraphqlOperation['kind']>): string {
  const byField = new Map<string, GqlOperation[]>();
  for (const op of model.ops) for (const f of op.rootFields) byField.set(f, [...(byField.get(f) ?? []), op]);
  const out: string[] = [];
  out.push('# Backend alanı → frontend işlemi → ekran', '');
  out.push(`${model.ops.length} GraphQL işlemi; backend'de ${backend.size} Query/Mutation/Subscription alanı. Kod commit'leri frontmatter'da (\`code_commit\`).`, '');

  out.push('## Frontend\'in çağırdığı backend alanları', '', '| Backend alanı | Tür | Frontend işlem(ler)i | Ekranlar |', '|---|---|---|---|');
  for (const field of [...byField.keys()].sort()) {
    const ops = byField.get(field)!;
    const routes = [...new Set(ops.flatMap(op => (model.opUsers.get(opKey(op)) ?? []).filter(u => model.reachable.has(u)).flatMap(u => routesReaching(model, u))))].sort();
    const kind = backend.get(field) ?? '**backend\'de yok**';
    out.push(`| ${code(field)} | ${kind} | ${ops.map(op => `[${op.name}](../api/${kebab(op.name)}.md)`).join(', ')} | ${routes.map(r => routeLink(r, 'genel')).join(', ') || '_erişilmiyor_'} |`);
  }
  out.push('');

  const unused = [...backend.entries()].filter(([f]) => !byField.has(f)).sort(([a], [b]) => a.localeCompare(b));
  out.push('## Frontend\'in hiç çağırmadığı backend alanları', '');
  out.push('Admin paneli, iç servisler ya da başka istemciler kullanıyor olabilir; frontend açısından kullanılmıyor.', '');
  out.push('| Alan | Tür |', '|---|---|', ...unused.map(([f, k]) => `| ${code(f)} | ${k} |`), '');

  const missing = model.ops.filter(op => op.rootFields.some(f => !backend.has(f)));
  out.push('## Backend\'de olmayan alanı çağıran frontend işlemleri', '');
  out.push(missing.length ? ['| İşlem | Eksik alan | Tanım |', '|---|---|---|', ...missing.map(op => `| [${op.name}](../api/${kebab(op.name)}.md) | ${op.rootFields.filter(f => !backend.has(f)).map(code).join(', ')} | ${code(op.file)} |`)].join('\n') : '_Yok._', '');
  return out.join('\n');
}

function renderUnused(model: FrontendModel): string {
  const files = [...model.files.keys()].filter(f => !model.reachable.has(f)).sort();
  const byDir = new Map<string, string[]>();
  for (const f of files) byDir.set(path.posix.dirname(f), [...(byDir.get(path.posix.dirname(f)) ?? []), f]);
  const out: string[] = [];
  out.push('# Kullanılmayan kod', '');
  out.push(`Hiçbir rotanın import ağacına girmeyen ${files.length} dosya (testler hariç) ve hiç kullanılmayan GraphQL işlemleri.`, '');
  out.push('## Hiçbir ekrandan erişilmeyen dosyalar', '');
  for (const [dir, list] of [...byDir.entries()].sort()) {
    out.push(`### ${code(dir)}`, '', ...list.map(f => `- ${code(path.posix.basename(f))}`), '');
  }
  const ops = model.ops.filter(op => usageOf(model, op) !== 'aktif');
  out.push('## Kullanılmayan ya da erişilmeyen GraphQL işlemleri', '');
  out.push(ops.length ? ['| İşlem | Durum | Tanım |', '|---|---|---|', ...ops.map(op => `| [${op.name}](../api/${kebab(op.name)}.md) | ${usageOf(model, op)} | ${code(op.file)} |`)].join('\n') : '_Yok._', '');
  return out.join('\n');
}

export interface FrontendDocsResult {
  commit: string;
  operations: number;
  routes: number;
  /** Generated files written (repo-relative to the area). */
  written: string[];
  /** Operation cards whose operation no longer exists (left for "kaldırıldı" marking). */
  orphanCards: string[];
}

export function generateFrontendDocs(opts: FrontendDocsOptions): FrontendDocsResult {
  const model = buildFrontendModel(opts.sourceDir);
  const backend = backendFields(opts.backendDir);
  const docsFor = backendDocsFor(loadDocs(opts.backendAreaDir));
  const written: string[] = [];
  const base = {code_commit: model.commit, generated_by: GENERATOR};

  const opsByUser = new Map<string, GqlOperation[]>();
  for (const op of model.ops) for (const u of model.opUsers.get(opKey(op)) ?? []) opsByUser.set(u, [...(opsByUser.get(u) ?? []), op]);

  for (const op of model.ops) {
    const rel = `api/${kebab(op.name)}.md`;
    const usage = usageOf(model, op);
    const backendStatus = op.rootFields.every(f => backend.has(f)) ? 'var' : 'eksik';
    writeCard(
      path.join(opts.areaDir, rel),
      {type: 'api', name: op.name, kind: op.kind, usage, backend: backendStatus, source: op.file, ...base},
      renderOperation(model, op, backend, docsFor),
      '## Ne yapar\n\n_TODO: 1-2 cümle, iş diliyle: bu çağrı oyuncu için ne sağlar, ne zaman yapılır (AI doldurur)._\n',
    );
    written.push(rel);
  }

  for (const route of model.routes) {
    const rel = `ekranlar/${routeSlug(route)}.md`;
    writeCard(
      path.join(opts.areaDir, rel),
      {type: 'screen', name: JSON.stringify(routePath(route)), source: route, ...base},
      renderRoute(model, route, opsByUser),
      '## Ne gösterir\n\n_TODO: 2-3 cümle, iş diliyle: oyuncu bu ekranda ne görür, ne yapabilir, nereden gelinir (AI doldurur)._\n',
    );
    written.push(rel);
  }

  writeCard(
    path.join(opts.areaDir, 'genel/api-haritasi.md'),
    {type: 'overview', title: JSON.stringify('API haritası: backend alanı → frontend işlemi → ekran'), ...base},
    renderApiMap(model, backend),
    '## Bu belge ne için\n\n"Bu mutation\'ı uygulamada nereler çağırıyor?", "Backend\'deki şu alanı frontend kullanıyor mu?", "Frontend backend\'de olmayan bir alan çağırıyor mu?" sorularının cevabı. Tablolar koddan otomatik üretilir.\n',
  );
  written.push('genel/api-haritasi.md');

  writeCard(
    path.join(opts.areaDir, 'genel/kullanilmayan-kod.md'),
    {type: 'overview', title: JSON.stringify('Kullanılmayan kod (frontend)'), ...base},
    renderUnused(model),
    '## Bu belge ne için\n\n"Bu bileşen/ekran şu an uygulamada var mı?" sorusunun kod tarafı: hiçbir rotadan erişilmeyen dosyalar ve hiç kullanılmayan GraphQL işlemleri. Uzak ayar (Firebase Remote Config) ya da koşulla gizlenen ama kodda erişilebilen bileşenler burada görünmez; onlar akış dokümanlarında anlatılır.\n',
  );
  written.push('genel/kullanilmayan-kod.md');

  const live = new Set(model.ops.map(op => `${kebab(op.name)}.md`));
  const apiDir = path.join(opts.areaDir, 'api');
  const orphanCards = fs.existsSync(apiDir) ? fs.readdirSync(apiDir).filter(f => f.endsWith('.md') && !live.has(f)).map(f => `api/${f}`) : [];
  return {commit: model.commit, operations: model.ops.length, routes: model.routes.length, written, orphanCards};
}
