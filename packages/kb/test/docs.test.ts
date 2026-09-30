import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {FrontmatterError, listMarkdown, loadDocs, parseDoc, stringList} from '../src/docs.ts';
import {HAS_REAL_KB, REAL_KB_AREA, tmpDir, write} from './helpers.ts';

describe('parseDoc', () => {
  it('splits YAML frontmatter from the body', () => {
    const {meta, body} = parseDoc('---\ntitle: X\naliases: ["a", "b"]\nsources:\n  - src/a.ts # yorum\n---\n# Başlık\n');
    assert.deepEqual(meta, {title: 'X', aliases: ['a', 'b'], sources: ['src/a.ts']});
    assert.equal(body, '# Başlık\n');
  });

  it('treats a file without frontmatter as all body', () => {
    assert.deepEqual(parseDoc('# Sadece metin\n'), {meta: {}, body: '# Sadece metin\n'});
  });

  it('throws FrontmatterError on invalid YAML', () => {
    assert.throws(() => parseDoc('---\ntitle: [kapanmamış\n---\n'), FrontmatterError);
  });

  it('rejects frontmatter that is not a mapping', () => {
    assert.throws(() => parseDoc('---\n- a\n- b\n---\n'), FrontmatterError);
  });
});

describe('listMarkdown / loadDocs', () => {
  it('walks the area but skips tools and node_modules', () => {
    const dir = tmpDir();
    write(dir, 'flows/a/b.md', '---\ntitle: B\n---\nx');
    write(dir, 'modules/m.md', 'm');
    write(dir, 'tools/notes.md', 'araç');
    write(dir, 'node_modules/p/README.md', 'paket');
    write(dir, 'flows/a/c.txt', 'metin');
    assert.deepEqual(listMarkdown(dir), ['flows/a/b.md', 'modules/m.md']);
    fs.rmSync(dir, {recursive: true});
  });

  it('loads documents with broken frontmatter as body-only instead of failing', () => {
    const dir = tmpDir();
    write(dir, 'x.md', '---\ntitle: [bozuk\n---\nmetin');
    const [doc] = loadDocs(dir);
    assert.deepEqual(doc.meta, {});
    fs.rmSync(dir, {recursive: true});
  });

  it('parses every document of the real backend knowledge base', {skip: !HAS_REAL_KB && 'work/kb yok'}, () => {
    const area = REAL_KB_AREA;
    for (const rel of listMarkdown(area)) {
      const text = fs.readFileSync(path.join(area, rel), 'utf8');
      assert.doesNotThrow(() => parseDoc(text), `${rel} frontmatter'ı okunamadı`);
    }
  });
});

describe('stringList', () => {
  it('keeps only strings from arrays', () => {
    assert.deepEqual(stringList(['a', 1, 'b', null]), ['a', 'b']);
    assert.deepEqual(stringList('a'), []);
    assert.deepEqual(stringList(undefined), []);
  });
});
