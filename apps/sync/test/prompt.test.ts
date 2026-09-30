import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {describe, it} from 'node:test';
import type {Impact} from '../src/impact.ts';
import {buildFixMessage, buildRunMessage, loadSystemPrompt} from '../src/prompt.ts';
import {PROMPTS_DIR, tmpDir, write} from './helpers/repos.ts';

describe('loadSystemPrompt', () => {
  it('reads section 2 of the real prompts/backend/UPDATE-PROMPT.md', () => {
    const prompt = loadSystemPrompt(PROMPTS_DIR, 'backend');
    assert.match(prompt, /^Sen Efsane Başkan backend'inin/);
    assert.match(prompt, /BİTİŞ/);
    assert.ok(!prompt.includes('```'));
  });

  it('fails loudly when the section or its block is missing', () => {
    const dir = tmpDir();
    write(dir, 'backend/UPDATE-PROMPT.md', '# Başlık\n\n## 1. İşçi\n');
    assert.throws(() => loadSystemPrompt(dir, 'backend'), /"## 2\."/);
    write(dir, 'backend/UPDATE-PROMPT.md', '## 2. Prompt\n\nblok yok\n');
    assert.throws(() => loadSystemPrompt(dir, 'backend'), /```text/);
    fs.rmSync(dir, {recursive: true});
  });
});

describe('buildRunMessage', () => {
  const impact: Impact = {
    docs: new Map([
      ['modules/pvp-match.md', ['uç değişti: src/x.resolver.ts']],
      ['flows/pvp/gunluk-hak.md', ['sources: M src/a.ts', 'sabit: PVP_DAILY_LIMIT (src/a.ts)']],
    ]),
    cardModules: ['pvp-match'],
    newModules: ['fresh'],
    removedModules: [],
  };
  const msg = buildRunMessage({
    job: {base: 'b', head: 'h', merges: [{sha: 'h'.repeat(40), subject: 'Merge pull request #562 from org/fix', pr: 562}]},
    base7: 'aaaaaaaa',
    head7: 'bbbbbbbb',
    date: '2026-09-29',
    changes: [
      {status: 'M', path: 'src/a.ts'},
      {status: 'R', oldPath: 'src/old.ts', path: 'src/new.ts'},
    ],
    impact,
    area: 'backend',
    kbRoot: '/srv/kb',
    codeDir: '/srv/code',
  });

  it('follows the section 5 template', () => {
    assert.match(msg, /^BASE: aaaaaaaa {2}HEAD: bbbbbbbb {2}Tarih: 2026-09-29/);
    assert.match(msg, /#562 Merge pull request #562/);
    assert.match(msg, /^M src\/a\.ts$/m);
    assert.match(msg, /^R src\/old\.ts -> src\/new\.ts$/m);
    assert.match(msg, /^flows\/pvp\/gunluk-hak\.md {2}← sources: M src\/a\.ts; sabit: PVP_DAILY_LIMIT/m);
    assert.match(msg, /Yeni modüller: fresh/);
    assert.match(msg, /git -C \/srv\/code diff aaaaaaaa bbbbbbbb -- <yol>/);
    assert.match(msg, /\/srv\/kb\/backend/);
  });

  it('sorts the impact list', () => {
    assert.ok(msg.indexOf('flows/pvp') < msg.indexOf('modules/pvp-match'));
  });

  it('says so when the impact list is empty', () => {
    const empty = buildRunMessage({
      job: {base: 'b', head: 'h', merges: []},
      base7: 'a',
      head7: 'b',
      date: 'd',
      changes: [],
      impact: {docs: new Map(), cardModules: [], newModules: [], removedModules: []},
      area: 'backend',
      kbRoot: '/k',
      codeDir: '/c',
    });
    assert.match(empty, /\(boş:/);
  });
});

describe('buildFixMessage', () => {
  it('lists the validation errors', () => {
    assert.equal(buildFixMessage(['a hatası', 'b hatası']).split('\n').slice(2).join('\n'), '- a hatası\n- b hatası');
  });
});
