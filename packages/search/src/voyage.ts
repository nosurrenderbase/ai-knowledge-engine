/**
 * Minimal client for the Voyage embeddings API (direct or through MongoDB Atlas).
 * Batches inputs, retries rate limits and server errors with backoff.
 */

export type InputType = 'document' | 'query';

export interface VoyageConfig {
  apiKey: string;
  /** Host or base URL as given by Voyage/Atlas: "ai.mongodb.com", "https://api.voyageai.com/v1", ... */
  baseUrl: string;
  dimension: number;
  /** Inputs per request. */
  batchSize?: number;
  maxRetries?: number;
}

/** Turns whatever the provider handed out into the embeddings endpoint URL. */
export function embeddingsUrl(base: string): string {
  let url = base.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  if (url.endsWith('/embeddings')) return url;
  if (!/\/v\d+$/.test(url)) url += '/v1';
  return `${url}/embeddings`;
}

export class VoyageError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`voyage ${status}: ${message}`);
    this.status = status;
  }
}

export interface EmbedResult {
  vectors: Float32Array[];
  tokens: number;
}

/** What the indexer and search need from an embedding provider. */
export interface Embedder {
  embed(model: string, texts: string[], inputType: InputType): Promise<EmbedResult>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class Voyage implements Embedder {
  private readonly cfg: Required<VoyageConfig>;
  private readonly url: string;

  constructor(cfg: VoyageConfig) {
    this.cfg = {batchSize: 64, maxRetries: 6, ...cfg};
    this.url = embeddingsUrl(cfg.baseUrl);
  }

  private async request(model: string, inputs: string[], inputType: InputType): Promise<EmbedResult> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}`},
        body: JSON.stringify({input: inputs, model, input_type: inputType, output_dimension: this.cfg.dimension}),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) {
        const body = (await res.json()) as {data: {embedding: number[]; index: number}[]; usage: {total_tokens: number}};
        const vectors = new Array<Float32Array>(inputs.length);
        for (const d of body.data) vectors[d.index] = Float32Array.from(d.embedding);
        return {vectors, tokens: body.usage.total_tokens};
      }
      const text = (await res.text()).slice(0, 300);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.cfg.maxRetries) throw new VoyageError(res.status, text);
      const after = Number(res.headers.get('retry-after'));
      await sleep(after > 0 ? after * 1000 : Math.min(60_000, 1000 * 2 ** attempt));
    }
  }

  /** Embeds any number of texts, in order. */
  async embed(model: string, texts: string[], inputType: InputType): Promise<EmbedResult> {
    const vectors: Float32Array[] = [];
    let tokens = 0;
    for (let i = 0; i < texts.length; i += this.cfg.batchSize) {
      const batch = await this.request(model, texts.slice(i, i + this.cfg.batchSize), inputType);
      vectors.push(...batch.vectors);
      tokens += batch.tokens;
    }
    return {vectors, tokens};
  }
}
