/**
 * KbIndexer against the local Redis and real git repos (the sync fixture).
 * Skipped when Redis is not running.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {after, afterEach, beforeEach, describe, it} from 'node:test';
import {createClient} from 'redis';
import {dropIndex, loadDotEnv, loadSearchConfig, readMeta, type Embedder, type IndexTarget, type RedisClient} from '@ai-knowledge-engine/search';
import {KbIndexer} from '../src/kb-index.ts';
import {cleanup, git, setupFixture, write, type Fixture} from './helpers/repos.ts';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

class CountingEmbedder implements Embedder {
  texts = 0;
  fail = false;
  async embed(_model: string, texts: string[]) {
    if (this.fail) throw new Error('voyage kapalı');
    this.texts += texts.length;
    return {vectors: texts.map((_, i) => Float32Array.from({length: 8}, (_, j) => (i + j) % 3)), tokens: texts.length};
  }
}

await loadDotEnv(process.env);
let client: RedisClient | null = null;
if (process.env.REDIS_PASSWORD) {
  const cfg = loadSearchConfig({...process.env, VOYAGE_API_KEY: 'x', VOYAGE_API_URL: 'x'});
  const c = createClient({url: cfg.redisUrl, password: cfg.redisPassword, socket: {connectTimeout: 2000, reconnectStrategy: false}});
  try {
    await c.connect();
    client = c;
  } catch {
    client = null;
  }
}
const skip = client ? false : 'yerel Redis yok (docker compose up -d)';

describe('KbIndexer', {skip}, () => {
  let fx: Fixture;
  let target: IndexTarget;
  let embedder: CountingEmbedder;
  let alerts: string[];
  let indexer: KbIndexer;

  beforeEach(() => {
    fx = setupFixture();
    const name = `test:kbindex:${process.pid}:${Date.now()}`;
    target = {name, prefix: `${name}:c:`, dimension: 8, model: 'fake'};
    embedder = new CountingEmbedder();
    alerts = [];
    indexer = new KbIndexer({
      cfg: fx.cfg,
      client: client!,
      embedder,
      target,
      cacheDir: null,
      log: () => {},
      alert: async m => void alerts.push(m),
    });
  });
  after(async () => {
    await client!.quit();
  });
  afterEach(async () => {
    await dropIndex(client!, target);
    for await (const keys of client!.scanIterator({MATCH: `${target.name}*`, COUNT: 500})) if (keys.length) await client!.del(keys);
    cleanup(fx);
  });

  it('indexes the knowledge base at its remote head, then stays idle until it moves', async () => {
    assert.equal(await indexer.reconcile(), 'indexed');
    const head = git(fx.kbSeed, 'rev-parse', 'HEAD');
    assert.equal((await readMeta(client!, target)).commit, head);
    const embedded = embedder.texts;
    assert.ok(embedded > 0);

    assert.equal(await indexer.reconcile(), 'up-to-date');
    assert.equal(embedder.texts, embedded);
  });

  it('picks up a new commit on the knowledge base (the worker push or a hand edit), embedding only what changed', async () => {
    await indexer.reconcile();
    const before = embedder.texts;
    const flow = 'backend/flows/pvp/gunluk-hak.md';
    write(fx.kbSeed, flow, fs.readFileSync(`${fx.kbSeed}/${flow}`, 'utf8').replace('= 3 maç', '= 4 maç'));
    git(fx.kbSeed, 'commit', '--quiet', '-am', 'elle düzeltme');
    git(fx.kbSeed, 'push', '--quiet', 'origin', 'main');

    assert.equal(await indexer.reconcile(), 'indexed');
    assert.equal(embedder.texts - before, 1);
    assert.equal((await readMeta(client!, target)).commit, git(fx.kbSeed, 'rev-parse', 'HEAD'));
  });

  it('skips quietly while Redis is not ready (right after a reboot)', async () => {
    const logs: string[] = [];
    const notReady = new KbIndexer({
      cfg: fx.cfg,
      client: {isReady: false} as unknown as RedisClient,
      embedder,
      target,
      cacheDir: null,
      log: (_level, msg) => void logs.push(msg),
      alert: async m => void alerts.push(m),
    });
    for (let i = 0; i < 5; i++) assert.equal(await notReady.reconcile(), 'failed');
    assert.equal(alerts.length, 0);
    assert.equal(embedder.texts, 0);
    assert.match(logs[0], /redis hazır değil/);
  });

  it('never throws, retries next time and alerts once after three failures in a row', async () => {
    embedder.fail = true;
    for (let i = 0; i < 4; i++) assert.equal(await indexer.reconcile(), 'failed');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /3 turdur güncellenemiyor: voyage kapalı/);
    embedder.fail = false;
    assert.equal(await indexer.reconcile(), 'indexed');
  });
});

