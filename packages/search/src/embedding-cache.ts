import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Embeddings on disk, keyed by chunk hash (or query text), one file per model
 * and input type. If Redis is ever lost, the index is rebuilt from git and this
 * cache without paying for embeddings again.
 */
export class EmbeddingCache {
  private readonly file: string | null;
  private data: Record<string, string>;
  private dirty = false;

  /** `dir` null keeps the cache in memory only (tests). */
  constructor(dir: string | null, model: string, kind: 'document' | 'query') {
    this.file = dir ? path.join(dir, `${model}.${kind}.json`) : null;
    this.data = this.file && fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
  }

  get(key: string): Float32Array | undefined {
    const b64 = this.data[key];
    if (!b64) return undefined;
    const buf = Buffer.from(b64, 'base64');
    // Copy into an aligned buffer: Float32Array needs a 4-byte aligned offset.
    return new Float32Array(new Uint8Array(buf).buffer);
  }

  set(key: string, v: Float32Array): void {
    this.data[key] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
    this.dirty = true;
  }

  /** Drops entries whose keys are no longer in use (old chunk versions). */
  retain(keys: Set<string>): void {
    for (const key of Object.keys(this.data)) {
      if (!keys.has(key)) {
        delete this.data[key];
        this.dirty = true;
      }
    }
  }

  get size(): number {
    return Object.keys(this.data).length;
  }

  save(): void {
    if (!this.file || !this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }
}
