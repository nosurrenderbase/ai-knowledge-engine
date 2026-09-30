import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {Chunk} from '@ai-knowledge-engine/kb';
import {parseGroundTruth} from '../src/ground-truth.ts';
import {filterQuery} from '../src/search.ts';
import {chunkFields, createIndexArgs, rrf, textQuery, vectorBytes} from '../src/search-index.ts';
import {embeddingsUrl} from '../src/voyage.ts';

describe('embeddingsUrl', () => {
  it('accepts a bare host, a base URL or the full endpoint', () => {
    assert.equal(embeddingsUrl('ai.mongodb.com'), 'https://ai.mongodb.com/v1/embeddings');
    assert.equal(embeddingsUrl('https://api.voyageai.com/v1/'), 'https://api.voyageai.com/v1/embeddings');
    assert.equal(embeddingsUrl(' https://eu.example.com/v1/embeddings '), 'https://eu.example.com/v1/embeddings');
  });
});

describe('textQuery', () => {
  it('keeps meaningful terms, drops question words and punctuation, ORs them', () => {
    assert.equal(textQuery('Oyuncu günde kaç PvP maçı oynayabilir?'), 'oyuncu | günde | pvp | maçı | oynayabilir');
  });

  it('lower-cases the Turkish way and keeps constant names whole', () => {
    assert.equal(textQuery('İLK Lig ödülü PVP_DAILY_LIMIT nedir'), 'ilk | lig | ödülü | pvp_daily_limit');
  });

  it('escapes RediSearch syntax and drops duplicates', () => {
    assert.equal(textQuery('x-internal-api-key x-internal-api-key @admin'), 'x\\-internal\\-api\\-key | \\@admin');
  });

  it('returns an empty query when nothing meaningful is left', () => {
    assert.equal(textQuery('Ne? Nasıl? Kaç?'), '');
  });
});

describe('rrf', () => {
  it('ranks items found high in several lists first', () => {
    const fused = rrf([
      [{key: 'a', score: 9}, {key: 'b', score: 8}, {key: 'c', score: 7}],
      [{key: 'b', score: 1}, {key: 'd', score: 1}],
    ]);
    assert.deepEqual(fused.map(h => h.key), ['b', 'a', 'd', 'c']);
  });
});

describe('createIndexArgs', () => {
  it('declares Turkish text fields, tags and a cosine HNSW vector of the given size', () => {
    const args = createIndexArgs({name: 'kb', prefix: 'kb:', dimension: 1024}).join(' ');
    assert.match(args, /^FT\.CREATE kb ON HASH PREFIX 1 kb: LANGUAGE turkish SCHEMA /);
    assert.match(args, /title TEXT WEIGHT 3 aliases TEXT WEIGHT 2/);
    assert.match(args, /status TAG SEPARATOR \|/);
    assert.match(args, /vec VECTOR HNSW 6 TYPE FLOAT32 DIM 1024 DISTANCE_METRIC COSINE$/);
  });
});

describe('chunkFields', () => {
  it('stores searchable fields, the display text and the vector bytes', () => {
    const chunk: Chunk = {
      id: 'flows/pvp/x.md#Kurallar',
      hash: 'h',
      path: 'flows/pvp/x.md',
      kind: 'flow',
      embed_text: 'bağlam\nmetin',
      text: 'metin',
      meta: {module: 'pvp-match', status: "kod main'de, istemci bağlı değil", title: 'PvP', aliases: ['pvp hakkı', 'daily pvp'], headings: ['Kurallar', 'Hak']},
    };
    const v = Float32Array.from([1, 2]);
    const f = chunkFields(chunk, v);
    assert.equal(f.aliases, 'pvp hakkı, daily pvp');
    assert.equal(f.headings, 'Kurallar › Hak');
    assert.equal(f.status, "kod main'de, istemci bağlı değil");
    assert.deepEqual(f.vec, vectorBytes(v));
    assert.equal(chunkFields({...chunk, meta: {}}, v).status, 'yok');
  });
});

describe('parseGroundTruth', () => {
  it('reads questions and their target documents from the table', () => {
    const md = [
      '## Hangi soru için hangi doküman',
      '',
      '### Hesap',
      '',
      '| Soru | Doküman |',
      '|---|---|',
      '| Oyuncu nasıl giriş yapar? | [Giriş](../flows/giris/giris.md) |',
      '| Mağaza rafları | [Dizilim](../flows/magaza/a.md), [Flaş](../flows/magaza/b.md#x) |',
      '',
      '## Modül haritası',
      '| Soru gibi | [x](../modules/x.md) |',
    ].join('\n');
    assert.deepEqual(parseGroundTruth(md), [
      {text: 'Oyuncu nasıl giriş yapar?', docs: ['flows/giris/giris.md']},
      {text: 'Mağaza rafları', docs: ['flows/magaza/a.md', 'flows/magaza/b.md']},
    ]);
  });
});

describe('weighted rrf', () => {
  it('lets a heavier list win ties', () => {
    const text = [{key: 'a', score: 1}, {key: 'b', score: 1}];
    const vec = [{key: 'b', score: 1}, {key: 'a', score: 1}];
    assert.equal(rrf([text, vec], 20, [1, 2])[0].key, 'b');
    assert.equal(rrf([text, vec], 20, [2, 1])[0].key, 'a');
  });
});

describe('filterQuery', () => {
  it('hides removed documents by default and escapes tag values', () => {
    assert.equal(filterQuery(), '-@status:{kaldırıldı}');
    assert.equal(filterQuery({module: 'pvp-match', kind: 'flow', includeRemoved: true}), '@module:{pvp\\-match} @kind:{flow}');
  });
});
