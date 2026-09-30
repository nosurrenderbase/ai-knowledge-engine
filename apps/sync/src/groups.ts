import type {Impact} from './impact.ts';

/** Which part of the knowledge base a document belongs to, for splitting large jobs. */
export function groupKey(doc: string): string {
  const parts = doc.split('/');
  if (parts[0] === 'genel') return 'genel';
  if (parts[0] === 'modules') return parts[1].replace(/\.md$/, '');
  if (parts[0] === 'usecases') return parts[1];
  if (parts[0] === 'flows') return `flows/${parts[1]}`;
  return parts[0];
}

/**
 * Splits a large impact list into Claude calls of at most `maxDocs` documents,
 * keeping each module's documents together and `genel/` last (overview
 * documents summarise the others, so they are updated after them).
 */
export function planGroups(impact: Impact, maxDocs: number): Impact[] {
  if (impact.docs.size <= maxDocs) return [impact];
  const byKey = new Map<string, [string, string[]][]>();
  for (const entry of [...impact.docs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const key = groupKey(entry[0]);
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }
  const keys = [...byKey.keys()].filter(k => k !== 'genel');
  if (byKey.has('genel')) keys.push('genel');

  const groups: [string, string[]][][] = [];
  let current: [string, string[]][] = [];
  for (const key of keys) {
    const entries = byKey.get(key)!;
    const last = key === 'genel';
    if (current.length > 0 && (last || current.length + entries.length > maxDocs)) {
      groups.push(current);
      current = [];
    }
    current.push(...entries);
  }
  if (current.length) groups.push(current);

  return groups.map(entries => ({...impact, docs: new Map(entries)}));
}
