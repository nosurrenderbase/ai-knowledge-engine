import * as fs from 'node:fs';
import * as path from 'node:path';
import type {Change} from './changes.ts';
import type {Impact} from './impact.ts';
import type {Job} from './queue.ts';

/**
 * The system prompt lives in `prompts/<area>/UPDATE-PROMPT.md`, section 2,
 * inside the first ```text block. Reading it from there keeps one source of truth.
 */
export function loadSystemPrompt(promptsDir: string, area: string): string {
  const doc = fs.readFileSync(path.join(promptsDir, area, 'UPDATE-PROMPT.md'), 'utf8');
  const section = doc.search(/^## 2\./m);
  if (section < 0) throw new Error('UPDATE-PROMPT.md içinde "## 2." bölümü yok');
  const m = /```text\n([\s\S]*?)\n```/.exec(doc.slice(section));
  if (!m) throw new Error('UPDATE-PROMPT.md bölüm 2 içinde ```text bloğu yok');
  return m[1].trim();
}

export interface RunMessageInput {
  job: Job;
  base7: string;
  head7: string;
  date: string;
  changes: Change[];
  impact: Impact;
  area: string;
  kbRoot: string;
  codeDir: string;
  /** Set when a large job is split into several calls. */
  part?: {index: number; total: number};
}

/** The per-job message (UPDATE-PROMPT.md section 5). */
export function buildRunMessage(input: RunMessageInput): string {
  const {job, impact} = input;
  const lines: string[] = [];
  lines.push(`BASE: ${input.base7}  HEAD: ${input.head7}  Tarih: ${input.date}`);
  if (input.part) {
    lines.push(
      `Bu büyük bir işin ${input.part.index}/${input.part.total}. parçası: yalnız aşağıdaki etki listesindeki dokümanlarla ilgilen; ` +
        'diğerleri ayrı çağrılarda güncelleniyor.',
    );
  }
  lines.push(`Merge edilen PR'lar: ${job.merges.map(m => (m.pr ? `#${m.pr} ${m.subject}` : `${m.sha.slice(0, 8)} ${m.subject}`)).join(' | ')}`);
  lines.push('');
  lines.push(`Bilgi tabanı dizini: ${path.join(input.kbRoot, input.area)} (yalnız buradaki .md dosyalarını düzenle)`);
  lines.push(`Kod reposu (salt okunur, HEAD'e checkout edilmiş): ${input.codeDir}`);
  lines.push('');
  lines.push('Değişen kod dosyaları:');
  for (const c of input.changes) {
    lines.push(c.status === 'R' ? `R ${c.oldPath} -> ${c.path}` : `${c.status} ${c.path}`);
  }
  lines.push('');
  lines.push('Etki listesi (işçi):');
  if (impact.docs.size === 0) lines.push('(boş: sources ve kategori kurallarıyla eşleşen doküman yok; yine de değişikliğe bak)');
  for (const [doc, reasons] of [...impact.docs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${doc}  ← ${reasons.join('; ')}`);
  }
  if (impact.newModules.length) lines.push(`Yeni modüller: ${impact.newModules.join(', ')}`);
  if (impact.removedModules.length) lines.push(`Kaldırılan modüller: ${impact.removedModules.join(', ')}`);
  if (impact.cardModules.length) lines.push(`Kartları yeniden üretilen modüller: ${impact.cardModules.join(', ')}`);
  lines.push('');
  lines.push(
    `Diff'leri gerektikçe \`git -C ${input.codeDir} diff ${input.base7} ${input.head7} -- <yol>\` ile, ` +
      `eski hali \`git -C ${input.codeDir} show ${input.base7}:<yol>\` ile al. ` +
      'Sistem prompt\'undaki kurallarla güncelle ve JSON raporla bitir.',
  );
  return lines.join('\n');
}

export function buildFixMessage(errors: string[]): string {
  return [
    'Doğrulama aşağıdaki hataları buldu. Yalnız bunları düzelt (başka yere dokunma), sonra JSON raporu yeniden ver:',
    '',
    ...errors.map(e => `- ${e}`),
  ].join('\n');
}
