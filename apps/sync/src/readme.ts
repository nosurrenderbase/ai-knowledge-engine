import * as fs from 'node:fs';
import * as path from 'node:path';
import {listMarkdown} from '@ai-knowledge-engine/kb';

export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Refreshes the "Durum" lines of `<area>/README.md`: the code commit and the
 * document counts. Lines that do not match the expected wording are left alone.
 */
export function updateReadmeStatus(areaDir: string, commit: string, date: Date): void {
  const file = path.join(areaDir, 'README.md');
  if (!fs.existsSync(file)) return;
  const docs = listMarkdown(areaDir);
  const count = (dir: string) => docs.filter(d => d.startsWith(`${dir}/`)).length;
  const modules = count('modules');
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/Kod commit: `[0-9a-f]+` \([^)]*\)/, `Kod commit: \`${commit}\` (${formatDate(date)}, main)`)
    .replace(
      /\d+ modülün hepsi belgelendi: \d+ akış dokümanı \(`flows\/`\), \d+ modül dokümanı \(`modules\/`\), \d+ use case kartı/,
      `${modules} modülün hepsi belgelendi: ${count('flows')} akış dokümanı (\`flows/\`), ${modules} modül dokümanı (\`modules/\`), ${count('usecases')} use case kartı`,
    )
    .replace(
      /\d+ akış dokümanı \(`flows\/`\), \d+ API kartı \(`api\/`\), \d+ ekran kartı \(`ekranlar\/`\)/,
      `${count('flows')} akış dokümanı (\`flows/\`), ${count('api')} API kartı (\`api/\`), ${count('ekranlar')} ekran kartı (\`ekranlar/\`)`,
    )
    .replace(
      /\d+ akış dokümanı \(`flows\/`\), \d+ metrik kartı \(`metrikler\/`\)/,
      `${count('flows')} akış dokümanı (\`flows/\`), ${count('metrikler')} metrik kartı (\`metrikler/\`)`,
    );
  fs.writeFileSync(file, text);
}
