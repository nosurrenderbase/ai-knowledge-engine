import type {Change} from './changes.ts';
import {manualPart, stringList, type KbDoc} from '@ai-knowledge-engine/kb';

export interface Impact {
  /** Document path (relative to the area) → why it may need an update. */
  docs: Map<string, string[]>;
  /** Modules whose use case cards must be regenerated. */
  cardModules: string[];
  newModules: string[];
  removedModules: string[];
}

export interface CodeView {
  /** File content at the job's head (for added/modified files) or base (for deleted ones). */
  read(change: Change): Promise<string | null>;
  moduleExists(module: string): boolean;
}

const MODULE_PATH = /^src\/modules\/([^/]+)\//;

export function moduleOf(file: string): string | null {
  return MODULE_PATH.exec(file)?.[1] ?? null;
}

export function isUsecaseFile(file: string): boolean {
  return MODULE_PATH.test(file) && file.includes('/usecases/') && file.endsWith('.ts') && !file.endsWith('.spec.ts');
}

/** Card path the generator writes for a use case file (nested usecases/ folders land in the module folder). */
export function cardPath(file: string): string {
  const module = moduleOf(file)!;
  const base = file.slice(file.lastIndexOf('/') + 1, -'.ts'.length);
  return `usecases/${module}/${base}.md`;
}

/** Names a constants file exports; these are what documents quote. */
export function exportedNames(source: string): string[] {
  const names = new Set<string>();
  const re = /export\s+(?:declare\s+)?(?:const|let|enum|function|class|type|interface)\s+([A-Za-z_]\w*)/g;
  for (const m of source.matchAll(re)) {
    if (m[1].length >= 4) names.add(m[1]);
  }
  return [...names];
}

function isConstantsFile(file: string): boolean {
  return /\/constants\//.test(file) || file.endsWith('.constant.ts') || file.endsWith('.constants.ts');
}

/** Rules from UPDATE-PROMPT.md "Kategori kuralları": documents a change affects even when no `sources:` lists it. */
function categoryDocs(file: string, content: string | null): string[] {
  const docs: string[] = [];
  if (file.endsWith('.schema.ts') && file !== 'src/bootstrap/config/env.schema.ts') {
    docs.push('genel/veri-haritasi.md');
  } else if (content && /@Schema\(/.test(content)) {
    docs.push('genel/veri-haritasi.md');
  }
  if (file === 'src/bootstrap/config/env.schema.ts' || file === '.env.example') {
    docs.push('genel/altyapi.md');
  }
  if (/^k8s\/.*\.ya?ml$/.test(file) || file.startsWith('.github/workflows/')) {
    docs.push('genel/altyapi.md', 'genel/operasyon/cron-isleri.md');
  }
  if (file === 'package.json' || file.startsWith('scripts/')) {
    docs.push('genel/operasyon/elle-calistirilan-scriptler.md');
  }
  const internalController = content !== null && /@Controller\(\s*['"`]\/?(internal|webhooks?)\b/.test(content);
  if (internalController || /webhook/i.test(file) || /\/infra\/.*(adapter|client)[^/]*\.ts$/.test(file)) {
    docs.push('genel/dis-sistemler.md');
  }
  if (file.startsWith('src/common/') || file.startsWith('src/bootstrap/')) {
    docs.push('genel/altyapi.md');
  }
  return docs;
}

export async function computeImpact(changes: Change[], docs: KbDoc[], code: CodeView): Promise<Impact> {
  const impact = new Map<string, string[]>();
  const existing = new Set(docs.map(d => d.path));
  const add = (doc: string, reason: string) => {
    if (!existing.has(doc)) return;
    const reasons = impact.get(doc) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    impact.set(doc, reasons);
  };

  // Reverse index: code file → documents listing it in `sources:`.
  const bySource = new Map<string, string[]>();
  for (const doc of docs) {
    for (const src of [...stringList(doc.meta.sources), ...(typeof doc.meta.source === 'string' ? [doc.meta.source] : [])]) {
      const list = bySource.get(src) ?? [];
      list.push(doc.path);
      bySource.set(src, list);
    }
  }

  const cardModules = new Set<string>();
  const touchedModules = new Set<string>();
  const newCards: string[] = [];

  for (const change of changes) {
    const paths = change.oldPath ? [change.path, change.oldPath] : [change.path];
    for (const p of paths) {
      for (const doc of bySource.get(p) ?? []) {
        const how = change.status === 'R' ? `taşındı: ${change.oldPath} → ${change.path}` : `${change.status} ${p}`;
        add(doc, `sources: ${how}`);
      }
    }

    const content = await code.read(change);
    for (const doc of categoryDocs(change.path, content)) add(doc, `kategori: ${change.path}`);

    if (isConstantsFile(change.path) && content) {
      for (const name of exportedNames(content)) {
        const word = new RegExp(`\\b${name}\\b`);
        for (const doc of docs) {
          if (!word.test(doc.body)) continue;
          if (doc.path.startsWith('usecases/')) {
            // The generated table quotes the value: regenerate that module's cards.
            const module = doc.path.split('/')[1];
            if (code.moduleExists(module)) cardModules.add(module);
            if (!word.test(manualPart(doc.body))) continue;
          }
          add(doc.path, `sabit: ${name} (${change.path})`);
        }
      }
    }

    for (const p of paths) {
      const module = moduleOf(p);
      if (!module) continue;
      touchedModules.add(module);
      if (/\.(resolver|controller)\.ts$/.test(p)) {
        add(`modules/${module}.md`, `uç değişti: ${p}`);
        for (const doc of docs) {
          if (doc.path.startsWith('flows/') && doc.meta.module === module) add(doc.path, `uç değişti: ${p}`);
        }
      }
      if (isUsecaseFile(p)) {
        if (code.moduleExists(module)) cardModules.add(module);
        const card = cardPath(p);
        if (p === change.oldPath || change.status === 'D') {
          add(card, 'use case koddan kaldırıldı: "kaldırıldı" işaretle');
        } else if (change.status === 'A' || change.status === 'R') {
          newCards.push(card);
        } else {
          add(card, 'kart yeniden üretildi: "Ne yapar"ı kontrol et');
        }
      }
    }
  }

  const newModules: string[] = [];
  const removedModules: string[] = [];
  for (const module of touchedModules) {
    const documented = existing.has(`modules/${module}.md`);
    const exists = code.moduleExists(module);
    if (exists && !documented) newModules.push(module);
    if (!exists && documented) {
      removedModules.push(module);
      add(`modules/${module}.md`, 'modül koddan kaldırıldı');
    }
  }
  if (newModules.length > 0) add('genel/genel-bakis.md', `yeni modül: ${newModules.join(', ')}`);

  // New cards do not exist until the generator runs; report them anyway.
  for (const card of newCards) {
    existing.add(card);
    add(card, 'YENİ kart: "Ne yapar" TODO');
  }

  return {
    docs: impact,
    cardModules: [...cardModules].sort(),
    newModules: newModules.sort(),
    removedModules: removedModules.sort(),
  };
}
