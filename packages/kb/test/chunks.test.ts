import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {after, before, describe, it} from 'node:test';
import {buildChunks, MAX_CHARS, writeChunks, type Chunk} from '../src/chunks.ts';
import {HAS_REAL_KB, REAL_KB_AREA, read, tmpDir, write} from './helpers.ts';

const row = (i: number) => `| Kural ${i} | ${'değer '.repeat(12)} | SABİT_${i} | kod |`;

const FLOW = [
  '---',
  'type: flow',
  'module: pvp-match',
  'title: PvP günlük hak',
  'status: canlıda',
  'aliases: ["pvp hakkı", "daily pvp"]',
  '---',
  '',
  '# PvP günlük hak',
  '',
  'Giriş paragrafı.',
  '',
  '## Kurallar',
  '',
  '| Kural | Değer | Kaynak | Nerede |',
  '|---|---|---|---|',
  ...Array.from({length: 60}, (_, i) => row(i)),
  '',
  '## Akış',
  '',
  '```mermaid',
  'flowchart TD',
  '    A --> B',
  '```',
  '',
  'Adımlar.',
  '',
  '### Hata kodları',
  '',
  '`PVP_DAILY_LIMIT_REACHED` döner.',
  '',
].join('\n');

const CARD = [
  '---',
  'type: usecase',
  'module: pvp-match',
  'name: StartPvpUseCase',
  '---',
  '',
  '## Ne yapar',
  '',
  'PvP maçını başlatır.',
  '',
  '<!-- gen:start -->',
  '# StartPvpUseCase',
  '',
  '## Bağımlılıklar',
  '',
  'tablo',
  '<!-- gen:end -->',
  '',
].join('\n');

describe('buildChunks', () => {
  let area: string;
  let chunks: Chunk[];
  const byId = (id: string) => chunks.find(c => c.id === id)!;

  before(() => {
    area = tmpDir();
    write(area, 'flows/pvp/gunluk-hak.md', FLOW);
    write(area, 'usecases/pvp-match/start-pvp.usecase.md', CARD);
    write(area, 'README.md', '# okunmaz');
    write(area, 'tools/notes.md', '# okunmaz');
    chunks = buildChunks(area);
  });
  after(() => fs.rmSync(area, {recursive: true, force: true}));

  it('reads only genel, flows, modules and usecases', () => {
    assert.ok(chunks.every(c => /^(genel|flows|modules|usecases)\//.test(c.path)));
  });

  it('splits by ## and ### with stable ids', () => {
    const ids = chunks.map(c => c.id).filter(id => id.startsWith('flows/'));
    assert.ok(ids.includes('flows/pvp/gunluk-hak.md#giriş'));
    assert.ok(ids.includes('flows/pvp/gunluk-hak.md#Akış'));
    assert.ok(ids.includes('flows/pvp/gunluk-hak.md#Akış › Hata kodları'));
  });

  it('starts embed_text with the breadcrumb and aliases, and hashes it', () => {
    const c = byId('flows/pvp/gunluk-hak.md#Akış › Hata kodları');
    assert.equal(c.embed_text.split('\n')[0], 'Akış (pvp-match) › PvP günlük hak › Akış › Hata kodları');
    assert.equal(c.embed_text.split('\n')[1], 'Eş anlamlılar: pvp hakkı, daily pvp');
    assert.equal(c.hash, createHash('sha256').update(c.embed_text).digest('hex'));
    assert.equal(c.meta.status, 'canlıda');
    assert.deepEqual(c.meta.headings, ['Akış', 'Hata kodları']);
  });

  it('keeps Mermaid in text but not in embed_text', () => {
    const c = byId('flows/pvp/gunluk-hak.md#Akış');
    assert.match(c.text, /```mermaid/);
    assert.doesNotMatch(c.embed_text, /mermaid|flowchart/);
  });

  it('splits long tables by rows, repeating the header in every part', () => {
    const parts = chunks.filter(c => c.id.startsWith('flows/pvp/gunluk-hak.md#Kurallar#'));
    assert.ok(parts.length > 1);
    for (const p of parts) {
      assert.ok(p.text.startsWith('| Kural | Değer | Kaynak | Nerede |\n|---|---|---|---|'));
      assert.ok(p.text.length <= MAX_CHARS + 200);
    }
  });

  it('embeds only the "Ne yapar" paragraph of a card, without the generated block', () => {
    const cards = chunks.filter(c => c.path.startsWith('usecases/'));
    assert.deepEqual(cards.map(c => c.id), ['usecases/pvp-match/start-pvp.usecase.md#Ne yapar']);
    assert.equal(cards[0].kind, 'usecase');
    assert.match(cards[0].embed_text, /^Use case kartı \(pvp-match\) › StartPvpUseCase › Ne yapar\nPvP maçını başlatır\.$/);
  });

  it('writes one JSON object per line', () => {
    const out = path.join(area, 'chunks.jsonl');
    writeChunks(chunks, out);
    const lines = read(area, 'chunks.jsonl').trim().split('\n');
    assert.equal(lines.length, chunks.length);
    assert.deepEqual(JSON.parse(lines[0]), chunks[0]);
  });

  it('produces unique ids and no Mermaid in embed_text for the real knowledge base', {skip: !HAS_REAL_KB && 'work/kb yok'}, () => {
    const real = buildChunks(REAL_KB_AREA);
    assert.equal(new Set(real.map(c => c.id)).size, real.length);
    assert.ok(real.every(c => !c.embed_text.includes('```mermaid')));
  });
});
