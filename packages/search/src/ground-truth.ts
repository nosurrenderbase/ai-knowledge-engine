import * as fs from 'node:fs';
import * as path from 'node:path';

/** The document whose question table is the evaluation's ground truth. */
export const GROUND_TRUTH_DOC = 'genel/genel-bakis.md';

export interface Question {
  text: string;
  /** Area-relative paths of the documents that answer it. */
  docs: string[];
}

/**
 * Rows of the "Hangi soru için hangi doküman" table in genel/genel-bakis.md:
 * "| Soru | [a](../flows/x.md), [b](../flows/y.md) |".
 */
export function parseGroundTruth(markdown: string): Question[] {
  const start = markdown.indexOf('## Hangi soru için hangi doküman');
  if (start < 0) return [];
  const end = markdown.indexOf('\n## ', start + 1);
  const section = markdown.slice(start, end < 0 ? undefined : end);
  const questions: Question[] = [];
  for (const line of section.split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 4 || cells[1] === 'Soru' || cells[1].startsWith('---')) continue;
    const docs = [...cells[2].matchAll(/\]\(([^)#]+)/g)].map(m => path.posix.normalize(path.posix.join('genel', m[1])));
    if (docs.length) questions.push({text: cells[1], docs});
  }
  return questions;
}

export function groundTruth(area: string): Question[] {
  return parseGroundTruth(fs.readFileSync(path.join(area, GROUND_TRUTH_DOC), 'utf8'));
}
