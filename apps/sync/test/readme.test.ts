import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {describe, it} from 'node:test';
import {formatDate, updateReadmeStatus} from '../src/readme.ts';
import {read, README_STATUS, tmpDir, write} from './helpers/repos.ts';

describe('formatDate', () => {
  it('uses dd.mm.yyyy', () => assert.equal(formatDate(new Date(2026, 0, 5)), '05.01.2026'));
});

describe('updateReadmeStatus', () => {
  it('rewrites the commit line and the counts in the README status lines', () => {
    const dir = tmpDir();
    write(dir, 'README.md', README_STATUS);
    write(dir, 'flows/a/x.md', 'x');
    write(dir, 'flows/b/y.md', 'y');
    write(dir, 'modules/a.md', 'a');
    for (const n of [1, 2, 3]) write(dir, `usecases/a/u${n}.usecase.md`, 'u');

    updateReadmeStatus(dir, 'deadbeef', new Date(2026, 9, 1));
    const text = read(dir, 'README.md');
    assert.match(text, /Kod commit: `deadbeef` \(01\.10\.2026, main\)\. `\.source-commit` bunu tutar\./);
    assert.match(text, /1 modülün hepsi belgelendi: 2 akış dokümanı \(`flows\/`\), 1 modül dokümanı \(`modules\/`\), 3 use case kartı \(`usecases\/`/);
    fs.rmSync(dir, {recursive: true});
  });

  it('counts flows, API and screen cards in the frontend wording', () => {
    const dir = tmpDir();
    write(dir, 'README.md', '## Durum\n\n- Kod commit: `aaaa` (01.01.2026, main).\n- 9 akış dokümanı (`flows/`), 9 API kartı (`api/`), 9 ekran kartı (`ekranlar/`).\n');
    write(dir, 'flows/a/x.md', 'x');
    for (const n of [1, 2]) write(dir, `api/op${n}.md`, 'o');
    for (const n of [1, 2, 3]) write(dir, `ekranlar/s${n}.md`, 's');

    updateReadmeStatus(dir, 'deadbeef', new Date(2026, 9, 1));
    const text = read(dir, 'README.md');
    assert.match(text, /Kod commit: `deadbeef` \(01\.10\.2026, main\)/);
    assert.match(text, /1 akış dokümanı \(`flows\/`\), 2 API kartı \(`api\/`\), 3 ekran kartı \(`ekranlar\/`\)/);
    fs.rmSync(dir, {recursive: true});
  });

  it('counts flows and metric cards in the match engine wording', () => {
    const dir = tmpDir();
    write(dir, 'README.md', '- 0 akış dokümanı (`flows/`), 0 metrik kartı (`metrikler/`).\n');
    write(dir, 'flows/a/x.md', 'x');
    for (const n of [1, 2]) write(dir, `metrikler/m${n}.md`, 'm');
    updateReadmeStatus(dir, 'deadbeef', new Date(2026, 9, 1));
    assert.match(read(dir, 'README.md'), /1 akış dokümanı \(`flows\/`\), 2 metrik kartı \(`metrikler\/`\)/);
    fs.rmSync(dir, {recursive: true});
  });

  it('leaves unrecognised wording and missing READMEs alone', () => {
    const dir = tmpDir();
    assert.doesNotThrow(() => updateReadmeStatus(dir, 'x', new Date()));
    write(dir, 'README.md', '# Başka biçim\n');
    updateReadmeStatus(dir, 'x', new Date());
    assert.equal(read(dir, 'README.md'), '# Başka biçim\n');
    fs.rmSync(dir, {recursive: true});
  });
});
