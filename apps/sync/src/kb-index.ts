/**
 * Keeps the search index at the knowledge base's latest commit. Runs after each
 * worker tick, so it picks up the worker's own pushes and hand edits alike.
 * Indexing never blocks syncing: failures are logged, retried on the next tick
 * and alerted once after a few in a row.
 */
import * as path from 'node:path';
import {INDEX_SCHEMA, readMeta, syncIndex, type Embedder, type IndexTarget, type RedisClient} from '@ai-knowledge-engine/search';
import type {Config} from './config.ts';
import {Git} from './git.ts';
import type {Alerter, Logger} from './log.ts';

export interface KbIndexerDeps {
  cfg: Config;
  client: RedisClient;
  embedder: Embedder;
  target: IndexTarget;
  cacheDir: string | null;
  log: Logger;
  alert: Alerter;
  /** Consecutive failures before an alert. */
  alertAfter?: number;
}

export type ReconcileResult = 'up-to-date' | 'indexed' | 'failed';

export class KbIndexer {
  private readonly deps: KbIndexerDeps;
  private failures = 0;

  constructor(deps: KbIndexerDeps) {
    this.deps = deps;
  }

  async reconcile(): Promise<ReconcileResult> {
    const {cfg, log} = this.deps;
    if (!this.deps.client.isReady) {
      // Redis still starting (e.g. right after a reboot): try again next tick, no alert yet.
      log('info', 'arama indeksi bekliyor: redis hazır değil');
      return 'failed';
    }
    try {
      const kb = new Git(cfg.kbRepo);
      const head = await kb.remoteHead(cfg.kbRemote, cfg.kbBranch);
      const meta = await readMeta(this.deps.client, this.deps.target);
      if (meta.commit === head && meta.schema === INDEX_SCHEMA) {
        this.failures = 0;
        return 'up-to-date';
      }
      await kb.fetch(cfg.kbRemote);
      await kb.resetHard(`${cfg.kbRemote}/${cfg.kbBranch}`);
      const res = await syncIndex({
        client: this.deps.client,
        voyage: this.deps.embedder,
        target: this.deps.target,
        areaDir: path.join(cfg.kbRepo, cfg.area),
        commit: await kb.revParse('HEAD'),
        cacheDir: this.deps.cacheDir,
      });
      log('info', 'arama indeksi güncellendi', {commit: head.slice(0, 8), ...res});
      this.failures = 0;
      return 'indexed';
    } catch (e) {
      this.failures++;
      log('warn', 'arama indeksi güncellenemedi', {attempt: this.failures, error: (e as Error).message});
      if (this.failures === (this.deps.alertAfter ?? 3)) {
        await this.deps.alert(`arama indeksi ${this.failures} turdur güncellenemiyor: ${(e as Error).message}`);
      }
      return 'failed';
    }
  }
}
