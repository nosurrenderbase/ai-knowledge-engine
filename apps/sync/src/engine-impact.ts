/**
 * Which match engine documents a change to the engine may affect. Like the
 * frontend rules (frontend-impact.ts): the `sources:` and `models:` reverse
 * index first, then category rules, then the generated metric cards that
 * changed and the flows that use those stats.
 */
import {stringList, type KbDoc} from '@ai-knowledge-engine/kb';
import type {Change} from './changes.ts';
import type {Impact} from './impact.ts';

/** Changes that touch an overview document even when no `sources:` lists them. */
function categoryDocs(c: Change): string[] {
  const file = c.path;
  const docs: string[] = [];
  if (/^analysis\/[^/]+\.py$/.test(file) || (/^analysis\/out\/[^/]+\.json$/.test(file) && c.status !== 'M')) docs.push('genel/veri-ve-modeller.md');
  if (/^(k8s|terraform)\//.test(file) || /^Dockerfile/.test(file) || file.startsWith('.github/workflows/')) docs.push('genel/altyapi.md');
  if (/^internal\/(ai\/attr\.go|ai\/styles\.go|lineup\/attr_bridge\.go)$/.test(file)) docs.push('genel/metriklerin-etkisi.md');
  if (/^(main\.go|go\.mod)$/.test(file)) docs.push('genel/mimari.md');
  return docs;
}

const dir = (p: string) => p.slice(0, p.lastIndexOf('/'));

/**
 * @param generatedChanged area-relative generated documents (metrikler/, genel/metrik-haritasi.md,
 *   genel/oyun-stilleri.md) the card generator created or changed in this job.
 */
export function computeEngineImpact(changes: Change[], docs: KbDoc[], generatedChanged: string[], newCards: Set<string>): Impact {
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
    for (const src of [...stringList(doc.meta.sources), ...stringList(doc.meta.models)]) {
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
    for (const doc of categoryDocs(c)) add(doc, `kategori: ${c.path}`);
    // A new file nobody documents yet: the flows about its package should take it in.
    if (!covered && c.status === 'A' && /\.(go|json)$/.test(c.path)) {
      for (const doc of byDir.get(dir(c.path)) ?? []) add(doc, `aynı klasöre yeni dosya eklendi: ${c.path} (sources/models'a ekle)`);
    }
  }

  // Metric cards the generator changed, and the flows that use those stats.
  const byMetric = new Map<string, string[]>();
  for (const doc of docs) for (const m of stringList(doc.meta.metrics)) byMetric.set(m, [...(byMetric.get(m) ?? []), doc.path]);
  for (const card of generatedChanged) {
    if (card.startsWith('metrikler/')) {
      add(card, newCards.has(card) ? 'YENİ kart: TODO paragrafını doldur' : 'kart yeniden üretildi: paragrafı kontrol et');
      for (const flow of byMetric.get(card) ?? []) add(flow, `kullandığı statın motordaki etkisi değişti: ${card}`);
    } else if (card === 'genel/metrik-haritasi.md' || card === 'genel/oyun-stilleri.md') {
      add('genel/metriklerin-etkisi.md', `üretilmiş tablo değişti: ${card}`);
      if (card === 'genel/oyun-stilleri.md') add('flows/statlar/oyun-stilleri.md', `üretilmiş tablo değişti: ${card}`);
    }
  }

  return {docs: impact, cardModules: [], newModules: [], removedModules: []};
}
