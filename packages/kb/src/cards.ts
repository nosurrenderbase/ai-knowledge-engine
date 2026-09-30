/**
 * Use case kartı üreticisi.
 *
 * Kod reposundaki bir modülün use case'lerini ts-morph ile okur ve her biri
 * için <alan>/usecases/<modül>/<dosya>.md üretir. AI kullanılmaz: çıktı koddan
 * birebirdir.
 *
 * Kartta <!-- gen:start --> ... <!-- gen:end --> arası her çalıştırmada
 * yeniden yazılır. Bu işaretlerin DIŞINDAKİ her şey (AI'ın ya da insanın
 * yazdığı "Ne yapar" paragrafı) korunur.
 */
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ClassDeclaration,
  MethodDeclaration,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
} from 'ts-morph';

export const GEN_START = '<!-- gen:start -->';
export const GEN_END = '<!-- gen:end -->';
export const MANUAL_PLACEHOLDER =
  '## Ne yapar\n\n_TODO: 2-3 cümle, iş diliyle (AI doldurur)._\n';

/** Text between the generator markers (what the generator owns), or null when the markers are missing. */
export function genBlock(text: string): string | null {
  const s = text.indexOf(GEN_START);
  const e = text.indexOf(GEN_END);
  if (s < 0 || e < s) return null;
  return text.slice(s, e + GEN_END.length);
}

/** A card without its generated block: the human/AI-written part. */
export function manualPart(text: string): string {
  const block = genBlock(text);
  return block === null ? text : text.replace(block, '');
}

/** Path of a code file relative to the code repo root. */
type Rel = (file: string) => string;

const oneLine = (text: string, max = 160) => {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
const cell = (text: string) => oneLine(text).replace(/\|/g, '\\|');
const code = (text: string) => '`' + cell(text).replace(/`/g, "'") + '`';

function jsDoc(node: ClassDeclaration | MethodDeclaration): string {
  return node
    .getJsDocs()
    .map(d => d.getDescription().trim())
    .filter(Boolean)
    .join('\n\n');
}

/** execute() girdi tipini aynı dosyadaki interface'ten açar. */
function describeInterface(sf: SourceFile, typeName: string): string[] {
  const iface = sf.getInterface(typeName);
  if (!iface) return [];
  return iface.getProperties().map(p => {
    const doc = p
      .getJsDocs()
      .map(d => d.getDescription().trim())
      .join(' ');
    return `| ${code(p.getName() + (p.hasQuestionToken() ? '?' : ''))} | ${code(p.getTypeNode()?.getText() ?? '?')} | ${cell(doc)} |`;
  });
}

interface CallRow {
  from: string;
  dep: string;
  method: string;
  args: string;
}

/** this.<bağımlılık>.<metot>(argümanlar) çağrıları, metot sırasıyla. */
function collectCalls(cls: ClassDeclaration, deps: Set<string>): CallRow[] {
  const rows: CallRow[] = [];
  for (const m of cls.getMethods()) {
    m.forEachDescendant(node => {
      if (!Node.isCallExpression(node)) return;
      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;
      const target = expr.getExpression();
      if (!Node.isPropertyAccessExpression(target)) return;
      if (target.getExpression().getKind() !== SyntaxKind.ThisKeyword) return;
      const dep = target.getName();
      if (!deps.has(dep)) return;
      rows.push({
        from: m.getName(),
        dep,
        method: expr.getName(),
        args: node
          .getArguments()
          .map(a => oneLine(a.getText(), 80))
          .join(', '),
      });
    });
  }
  return rows;
}

/** domain/constants'tan import edilen sabitler ve koddaki değerleri. */
function collectConstants(sf: SourceFile, rel: Rel): string[] {
  const rows: string[] = [];
  for (const imp of sf.getImportDeclarations()) {
    if (!imp.getModuleSpecifierValue().includes('/constants/')) continue;
    for (const named of imp.getNamedImports()) {
      const decl = named
        .getNameNode()
        .getSymbol()
        ?.getAliasedSymbol()
        ?.getDeclarations()[0];
      if (!decl) continue;
      const where = `${rel(decl.getSourceFile().getFilePath())}:${decl.getStartLineNumber()}`;
      let value = '?';
      const nested: string[] = [];
      if (Node.isVariableDeclaration(decl)) {
        const init = decl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          const body = init.getBody();
          value = Node.isBlock(body)
            ? `fonksiyon (${init.getParameters().map(p => p.getText()).join(', ')}) → ${init.getReturnTypeNode()?.getText() ?? '?'}`
            : 'fonksiyon: ' + oneLine(init.getText(), 140);
          // Fonksiyonun içinde kullandığı sabitlerin değerleri (bir seviye).
          const seenNested = new Set<string>();
          init.forEachDescendant(n => {
            if (!Node.isIdentifier(n) || seenNested.has(n.getText())) return;
            const d = n.getSymbol()?.getDeclarations()[0];
            if (!d || !Node.isVariableDeclaration(d) || d === decl) return;
            if (!d.getSourceFile().getFilePath().includes('/constants/')) return;
            // Sadece dosya düzeyindeki sabitler; fonksiyon içi yerel değişkenler değil.
            if (!Node.isSourceFile(d.getVariableStatement()?.getParent())) return;
            const v = d.getInitializer();
            if (!v || Node.isArrowFunction(v) || Node.isFunctionExpression(v)) return;
            seenNested.add(n.getText());
            nested.push(
              `| ↳ ${code(n.getText())} | ${code(oneLine(v.getText(), 120))} | ${code(`${rel(d.getSourceFile().getFilePath())}:${d.getStartLineNumber()}`)} |`,
            );
          });
        } else {
          value = init ? oneLine(init.getText(), 120) : '?';
        }
      } else if (Node.isFunctionDeclaration(decl)) {
        value = 'fonksiyon';
      }
      rows.push(`| ${code(named.getName())} | ${code(value)} | ${code(where)} |`, ...nested);
    }
  }
  return rows;
}

/** throw new XError(...) listesi, hata kodu ve HTTP durumu ile. */
function collectErrors(cls: ClassDeclaration): string[] {
  const seen = new Map<string, string>();
  cls.forEachDescendant(node => {
    if (!Node.isThrowStatement(node)) return;
    const ex = node.getExpression();
    if (!Node.isNewExpression(ex)) return;
    const name = ex.getExpression().getText();
    if (seen.has(name)) return;
    const decl = ex
      .getExpression()
      .getSymbol()
      ?.getAliasedSymbol()
      ?.getDeclarations()[0];
    let codeValue = '';
    let status = '';
    if (decl && Node.isClassDeclaration(decl)) {
      codeValue =
        decl
          .getProperty('code')
          ?.getInitializer()
          ?.getText()
          .replace(/['"]/g, '') ?? '';
      status = decl.getText().match(/HttpStatus\.(\w+)/)?.[1] ?? '';
    }
    seen.set(name, `| ${code(name)} | ${code(codeValue || '-')} | ${cell(status || '-')} |`);
  });
  return [...seen.values()];
}

/** Bu sınıfı kim çağırıyor: resolver alanı, REST rotası, başka use case. */
function collectCallers(cls: ClassDeclaration, rel: Rel): string[] {
  const rows = new Set<string>();
  for (const ref of cls.findReferencesAsNodes()) {
    const file = ref.getSourceFile();
    const fp = file.getFilePath();
    if (fp === cls.getSourceFile().getFilePath()) continue;
    if (fp.endsWith('.module.ts') || fp.endsWith('.spec.ts')) continue;
    if (ref.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
    const param = ref.getFirstAncestorByKind(SyntaxKind.Parameter);
    const owner = ref.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    if (!param || !owner) continue;
    const paramName = param.getName();
    let entry = false;
    for (const m of owner.getMethods()) {
      if (!m.getText().includes(`this.${paramName}.`)) continue;
      const dec = m
        .getDecorators()
        .find(d =>
          ['Query', 'Mutation', 'Subscription', 'Post', 'Get', 'Put', 'Patch', 'Delete', 'Cron'].includes(
            d.getName(),
          ),
        );
      if (dec) {
        entry = true;
        const gqlName = dec.getText().match(/name:\s*'([^']+)'/)?.[1];
        const route = dec.getArguments()[0]?.getText().replace(/['"]/g, '');
        const label =
          dec.getName() === 'Query' || dec.getName() === 'Mutation' || dec.getName() === 'Subscription'
            ? `GraphQL ${dec.getName()} \`${gqlName ?? m.getName()}\``
            : dec.getName() === 'Cron'
              ? `Cron \`${route ?? ''}\``
              : `REST ${dec.getName().toUpperCase()} \`${route ?? m.getName()}\``;
        rows.add(`| ${label} | ${code(`${owner.getName()}.${m.getName()}`)} | ${code(rel(fp))} |`);
      }
    }
    if (!entry) {
      const users = owner
        .getMethods()
        .filter(m => m.getText().includes(`this.${paramName}.`))
        .map(m => m.getName());
      const label = `${owner.getName() ?? '?'}${users.length ? '.' + users.join(' / ') : ''}`;
      rows.add(`| Kod içi | ${code(label)} | ${code(rel(fp))} |`);
    }
  }
  return [...rows];
}

function isExported(moduleFile: SourceFile | undefined, name: string): boolean {
  if (!moduleFile) return false;
  const m = moduleFile.getText().match(/exports:\s*\[([\s\S]*?)\]/);
  return !!m && new RegExp(`\\b${name}\\b`).test(m[1]);
}

function renderCard(cls: ClassDeclaration, moduleName: string, rel: Rel, moduleFile?: SourceFile): string {
  const sf = cls.getSourceFile();
  const name = cls.getName()!;
  const ctor = cls.getConstructors()[0];
  const params = ctor?.getParameters() ?? [];
  const deps = new Set(params.map(p => p.getName()));
  const exec = cls.getMethod('execute');
  const out: string[] = [];

  out.push(`# ${name}`, '');
  out.push(`- **Dosya:** \`${rel(sf.getFilePath())}\``);
  out.push(`- **Modül:** \`${moduleName}\``);
  out.push(`- **Diğer modüllere açık mı:** ${isExported(moduleFile, name) ? 'Evet (module exports)' : 'Hayır, modül içi'}`);
  if (exec) {
    const decs = exec.getDecorators().map(d => oneLine(d.getText(), 100));
    const sig = exec
      .getParameters()
      .map(p => `${p.getName()}: ${p.getTypeNode()?.getText() ?? '?'}`)
      .join(', ');
    out.push(`- **Giriş noktası:** \`execute(${sig})\` → \`${oneLine(exec.getReturnTypeNode()?.getText() ?? '?')}\``);
    out.push(`- **Decorator'lar:** ${decs.length ? decs.map(d => '`' + d + '`').join(', ') : 'yok'}`);
  } else {
    const pub = cls
      .getMethods()
      .filter(m => !m.hasModifier(SyntaxKind.PrivateKeyword))
      .map(m => `\`${m.getName()}(${m.getParameters().map(p => `${p.getName()}: ${p.getTypeNode()?.getText() ?? '?'}`).join(', ')})\``);
    out.push(`- **Açık metotlar:** ${pub.join(', ') || 'yok'}`);
  }
  out.push('');

  const doc = jsDoc(cls);
  if (doc) {
    out.push('## Koddaki açıklama (JSDoc, birebir)', '', doc.split('\n').map(l => '> ' + l).join('\n'), '');
  }

  const inputType = exec?.getParameters()[0]?.getTypeNode()?.getText();
  const inputRows = inputType ? describeInterface(sf, inputType) : [];
  if (inputRows.length) {
    out.push(`## Girdi: \`${inputType}\``, '', '| Alan | Tip | Açıklama |', '|---|---|---|', ...inputRows, '');
  }

  if (params.length) {
    out.push('## Bağımlılıklar (constructor)', '', '| Ad | Tip |', '|---|---|');
    for (const p of params) {
      out.push(`| ${code(p.getName())} | ${code(p.getTypeNode()?.getText() ?? '?')} |`);
    }
    out.push('');
  }

  const calls = collectCalls(cls, deps);
  if (calls.length) {
    out.push('## Çağrılar (hangi metottan, kimi, hangi argümanla)', '', '| Nereden | Çağrılan | Argümanlar |', '|---|---|---|');
    for (const c of calls) {
      out.push(`| ${code(c.from)} | ${code(`${c.dep}.${c.method}`)} | ${code(c.args || '-')} |`);
    }
    out.push('');
  }

  const constants = collectConstants(sf, rel);
  if (constants.length) {
    out.push('## Kullandığı sabitler (değer koddan okunmuştur)', '', '| Sabit | Değer | Kaynak |', '|---|---|---|', ...constants, '');
  }

  const errors = collectErrors(cls);
  if (errors.length) {
    out.push('## Fırlatabildiği hatalar', '', '| Hata sınıfı | Kod | HTTP |', '|---|---|---|', ...errors, '');
  }

  const callers = collectCallers(cls, rel);
  out.push('## Kim çağırıyor', '');
  if (callers.length) {
    out.push('| Tür | Sınıf.metot | Dosya |', '|---|---|---|', ...callers, '');
  } else {
    out.push('_Kod içinde doğrudan çağıran bulunamadı._', '');
  }

  const helpers = cls
    .getMethods()
    .filter(m => m.getName() !== 'execute' && m.hasModifier(SyntaxKind.PrivateKeyword));
  if (helpers.length) {
    out.push('## Yardımcı (private) metotlar', '');
    for (const h of helpers) {
      const d = jsDoc(h);
      out.push(`- \`${h.getName()}\`${d ? ' — ' + oneLine(d, 220) : ''}`);
    }
    out.push('');
  }

  return out.join('\n');
}

function writeCard(target: string, meta: Record<string, string>, generated: string) {
  const frontmatter = [
    '---',
    ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`),
    '---',
  ].join('\n');
  let manual = MANUAL_PLACEHOLDER;
  if (fs.existsSync(target)) {
    const prev = fs.readFileSync(target, 'utf8');
    const s = prev.indexOf(GEN_START);
    const e = prev.indexOf(GEN_END);
    const body = prev.replace(/^---[\s\S]*?---\n/, '');
    if (s >= 0 && e > s) {
      const bs = body.indexOf(GEN_START);
      manual = (body.slice(0, bs) + body.slice(body.indexOf(GEN_END) + GEN_END.length)).trim() + '\n';
    } else if (body.trim()) {
      // İşaretsiz, elle yazılmış kart: içeriği kaybetme, manuel bölüm say.
      manual = body.trim() + '\n';
    }
  }
  const content = `${frontmatter}\n\n${manual}\n${GEN_START}\n${generated}\n${GEN_END}\n`;
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, content);
}

export interface GenerateCardsOptions {
  /** Knowledge base area directory (e.g. <kb>/backend); cards go to its usecases/ folder. */
  areaDir: string;
  /** Code repo root, checked out at the commit to document. */
  sourceDir: string;
  modules: string[];
}

/** Generates the cards of the given modules. Returns how many cards each module got. */
export function generateCards({areaDir, sourceDir, modules}: GenerateCardsOptions): Record<string, number> {
  const counts: Record<string, number> = {};
  if (modules.length === 0) return counts;
  const commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], {cwd: sourceDir, encoding: 'utf8'}).trim();
  const project = new Project({
    tsConfigFilePath: path.join(sourceDir, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths([
    path.join(sourceDir, 'src/**/*.ts'),
    '!' + path.join(sourceDir, 'src/**/*.spec.ts'),
  ]);
  const rel: Rel = file => path.relative(sourceDir, file);

  for (const moduleName of modules) {
    const dir = path.join(sourceDir, 'src/modules', moduleName);
    const moduleFile = project.getSourceFile(path.join(dir, `${moduleName}.module.ts`));
    const files = project
      .getSourceFiles()
      // Any usecases/ folder inside the module, including nested sub-features
      // (e.g. building/stadium/usecases, team-player/transaction/usecases).
      .filter(f => {
        const p = f.getFilePath();
        return p.startsWith(dir + path.sep) && p.slice(dir.length).includes(`${path.sep}usecases${path.sep}`);
      });
    let count = 0;
    for (const sf of files) {
      for (const cls of sf.getClasses()) {
        if (!cls.getName()) continue;
        const base = path.basename(sf.getFilePath(), '.ts');
        const target = path.join(areaDir, 'usecases', moduleName, `${base}.md`);
        writeCard(
          target,
          {
            type: 'usecase',
            module: moduleName,
            name: cls.getName()!,
            source: rel(sf.getFilePath()),
            code_commit: commit,
            generated_by: 'ai-knowledge-engine/packages/kb',
          },
          renderCard(cls, moduleName, rel, moduleFile),
        );
        count++;
      }
    }
    counts[moduleName] = count;
  }
  return counts;
}
