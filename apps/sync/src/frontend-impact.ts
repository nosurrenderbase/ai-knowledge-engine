/**
 * Which frontend documents a change to the app may affect. Like the backend
 * rules (impact.ts): the `sources:` reverse index first, then category rules,
 * then the generated cards that changed and the flows that use them.
 */
import {stringList, type KbDoc} from '@ai-knowledge-engine/kb';
import type {Change} from './changes.ts';
import type {Impact} from './impact.ts';

/** Changes that touch a whole overview document even when no `sources:` lists them. */
function categoryDocs(file: string): string[] {
  const docs: string[] = [];
  if (/^src\/lib\/remoteConfig\.ts$|^src\/atoms\/updateNudgeAtoms\.ts$|^src\/lib\/pveMatchFlag\.ts$/.test(file)) docs.push('genel/uzak-ayarlar.md');
  if (file.startsWith('src/lib/analytics/')) docs.push('genel/analitik.md');
  if (/^src\/lib\/apollo\//.test(file) || /^(app\/_layout\.tsx|app\.config\.js|eas\.json|package\.json|metro\.config\.js)$/.test(file)) {
    docs.push('genel/mimari.md');
  }
  return docs;
}

const dir = (p: string) => p.slice(0, p.lastIndexOf('/'));

/**
 * @param generatedChanged area-relative generated documents (api/, ekranlar/)
 *   the card generator created or changed in this job.
 */
export function computeFrontendImpact(changes: Change[], docs: KbDoc[], generatedChanged: string[], newCards: Set<string>): Impact {
  const impact = new Map<string, string[]>();
  const existing = new Set(docs.map(d => d.path));
  const add = (doc: string, reason: string) => {
    if (!existing.has(doc) && !newCards.has(doc)) return;
    const reasons = impact.get(doc) ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    impact.set(doc, reasons);
  };

  const bySource = new Map<string, string[]>();
  const byDir = new Map<string, Set<string>>();
  for (const doc of docs) {
    if (!doc.path.startsWith('flows/') && !doc.path.startsWith('genel/')) continue;
    for (const src of stringList(doc.meta.sources)) {
      bySource.set(src, [...(bySource.get(src) ?? []), doc.path]);
      if (!byDir.has(dir(src))) byDir.set(dir(src), new Set());
      byDir.get(dir(src))!.add(doc.path);
    }
  }

  for (const c of changes) {
    const paths = c.oldPath ? [c.path, c.oldPath] : [c.path];
    let covered = false;
    for (const p of paths) {
      for (const doc of bySource.get(p) ?? []) {
        covered = true;
        add(doc, c.status === 'R' ? `sources: taşındı: ${c.oldPath} → ${c.path}` : `sources: ${c.status} ${p}`);
      }
    }
    for (const doc of categoryDocs(c.path)) add(doc, `kategori: ${c.path}`);
    // A new file nobody documents yet: the flows about its folder should take it in.
    if (!covered && c.status === 'A' && /\.(tsx?)$/.test(c.path)) {
      for (const doc of byDir.get(dir(c.path)) ?? []) add(doc, `aynı klasöre yeni dosya eklendi: ${c.path} (sources'a ekle)`);
    }
  }

  // Cards the generator changed, and the flows that use those operations.
  const byApi = new Map<string, string[]>();
  for (const doc of docs) for (const a of stringList(doc.meta.api)) byApi.set(a, [...(byApi.get(a) ?? []), doc.path]);
  for (const card of generatedChanged) {
    if (!card.startsWith('api/') && !card.startsWith('ekranlar/')) continue;
    add(card, newCards.has(card) ? 'YENİ kart: TODO paragrafını doldur' : 'kart yeniden üretildi: paragrafı kontrol et');
    for (const flow of byApi.get(card) ?? []) add(flow, `çağırdığı işlem değişti: ${card}`);
  }

  return {docs: impact, cardModules: [], newModules: [], removedModules: []};
}
