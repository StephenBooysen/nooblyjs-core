/**
 * @fileoverview Embedding client for semantic search.
 *
 * One interface over every way this framework can turn text into a dense
 * vector, so the search engine never learns which backend is configured:
 *
 * - `hash`      — deterministic, offline, zero-dependency signed-bucket hashing.
 *                 Poor as semantics, but instant, free and reproducible, which
 *                 makes it the right default for tests and for a first run with
 *                 no API keys configured.
 * - `aiservice` — delegates to an injected AI service instance's `embed()`
 *                 (OpenAI, Ollama, Gemini). Real semantics, real latency.
 * - a function  — any `async (texts, options) => number[][]` for callers that
 *                 want to bring their own model.
 *
 * Every vector leaves this module L2-normalized, which lets the vector store
 * treat cosine similarity as a plain dot product.
 *
 * Failure policy: a transient backend error is retried with exponential
 * backoff; a permanent one yields `null` for the affected texts rather than
 * throwing, so one unembeddable document cannot fail a whole batch. A
 * dimension mismatch is the exception — that is a configuration fault, not a
 * document fault, and it throws immediately.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 2026-08-27
 */

'use strict';

const crypto = require('node:crypto');

/** Offset basis and prime for 32-bit FNV-1a. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Seed for the sign hash, so bucket and sign are independent. */
const SIGN_SEED = 0x9e3779b1;

const DEFAULT_DIMENSIONS = 384;
const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_CHUNK_CHARS = 1200;
const DEFAULT_CHUNK_OVERLAP = 150;

/** HTTP statuses worth retrying: rate limits and server faults. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Transient network failures surfaced as error codes rather than statuses. */
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND'
]);

/**
 * 32-bit FNV-1a hash. Deterministic across platforms and Node versions, which
 * is what the `hash` backend's reproducibility rests on.
 *
 * @param {string} str Text to hash.
 * @param {number} [seed=FNV_OFFSET] Starting basis.
 * @return {number} Unsigned 32-bit hash.
 */
function fnv1a(str, seed = FNV_OFFSET) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/**
 * Split text into lowercase word tokens. Deliberately simpler than the search
 * engine's configurable tokenizer: the hash backend only needs a stable,
 * self-contained rule, not one that tracks index-time tokenization.
 *
 * @param {string} text
 * @return {Array<string>}
 */
function hashTokenize(text) {
  if (text == null) return [];
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length > 0);
}

/**
 * Scale a vector to unit length in place. A zero vector is left alone — there
 * is no meaningful direction to normalize it to, and callers treat it as
 * "no signal" rather than as an error.
 *
 * @param {Float32Array} vector Vector to normalize in place.
 * @return {Float32Array} The same instance, for chaining.
 */
function normalize(vector) {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) sumSquares += vector[i] * vector[i];
  if (sumSquares === 0) return vector;
  const inverse = 1 / Math.sqrt(sumSquares);
  for (let i = 0; i < vector.length; i++) vector[i] *= inverse;
  return vector;
}

/**
 * Deterministic offline embedding: hash each token into one of `dimensions`
 * buckets with a hash-derived sign, accumulate sublinear term frequency, then
 * L2-normalize.
 *
 * Sublinear weighting (`1 + log(tf)`) rather than raw counts keeps a word
 * repeated forty times from dominating the direction of the vector — the same
 * intuition BM25 applies on the lexical side.
 *
 * The same text always produces the same vector, in this process and any
 * other, which is what makes it usable as a test fixture.
 *
 * @param {string} text Text to embed.
 * @param {number} [dimensions=384] Vector width.
 * @return {Float32Array} Unit-length vector (all zeros for empty text).
 *
 * @example
 * const a = hashEmbed('password reset', 384);
 * const b = hashEmbed('password reset', 384);
 * // a and b are element-wise identical.
 */
function hashEmbed(text, dimensions = DEFAULT_DIMENSIONS) {
  const vector = new Float32Array(dimensions);
  const tokens = hashTokenize(text);
  if (tokens.length === 0) return vector;

  const frequencies = new Map();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }

  for (const [token, count] of frequencies) {
    const bucket = fnv1a(token) % dimensions;
    const sign = (fnv1a(token, SIGN_SEED) & 1) === 0 ? 1 : -1;
    vector[bucket] += sign * (1 + Math.log(count));
  }

  return normalize(vector);
}

/**
 * Split long text into overlapping chunks, preferring to break at sentence
 * boundaries and falling back to word boundaries then a hard cut.
 *
 * Overlap exists so a passage straddling a boundary is still wholly present in
 * one chunk; without it, the sentence most relevant to a query can end up split
 * across two vectors and score poorly in both.
 *
 * Chunk ids follow the `<parentId>#chunk-<n>` convention `indexerCompat.js`
 * already assumes for sub-documents.
 *
 * @param {string} text Text to split.
 * @param {Object} [options] Chunking options.
 * @param {number} [options.maxChars=1200] Target maximum chunk length.
 * @param {number} [options.overlap=150] Characters repeated between chunks.
 * @return {Array<{text: string, index: number, start: number, end: number}>}
 *   One entry per chunk; a single entry when the text already fits.
 *
 * @example
 * chunkText(longArticle, { maxChars: 1000, overlap: 100 });
 */
function chunkText(text, options = {}) {
  const source = text == null ? '' : String(text);
  const maxChars = Math.max(1, options.maxChars || DEFAULT_CHUNK_CHARS);
  // Overlap must leave forward progress, or the walk below never terminates.
  const overlap = Math.max(0, Math.min(options.overlap ?? DEFAULT_CHUNK_OVERLAP, maxChars - 1));

  if (source.length === 0) return [];
  if (source.length <= maxChars) {
    return [{ text: source, index: 0, start: 0, end: source.length }];
  }

  const chunks = [];
  let start = 0;
  let index = 0;

  while (start < source.length) {
    const hardEnd = Math.min(start + maxChars, source.length);
    let end = hardEnd;

    if (hardEnd < source.length) {
      // Prefer a sentence boundary in the last third of the window, then any
      // whitespace, then give up and cut mid-word.
      const window = source.slice(start, hardEnd);
      const floor = Math.floor(maxChars * 0.6);
      const sentence = lastSentenceBreak_(window, floor);
      if (sentence > 0) {
        end = start + sentence;
      } else {
        const space = window.lastIndexOf(' ');
        if (space > floor) end = start + space + 1;
      }
    }

    const body = source.slice(start, end).trim();
    if (body) chunks.push({ text: body, index: index++, start, end });

    if (end >= source.length) break;
    const next = end - overlap;
    // Guarantee progress even if the boundary search returned something odd.
    start = next > start ? next : end;
  }

  return chunks;
}

/**
 * Index just past the last sentence-ending punctuation in `window`, or -1.
 *
 * @param {string} window Candidate chunk text.
 * @param {number} floor Ignore breaks before this offset — a break too early
 *   produces a uselessly short chunk.
 * @return {number} Offset just after the terminator, or -1.
 * @private
 */
function lastSentenceBreak_(window, floor) {
  for (let i = window.length - 1; i > floor; i--) {
    const ch = window[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '\n') continue;
    // A terminator only counts when followed by whitespace or end of window,
    // so "3.5" and "e.g." don't split a sentence.
    const next = window[i + 1];
    if (next === undefined || /\s/.test(next)) return i + 1;
  }
  return -1;
}

/**
 * Decide whether an error is worth retrying.
 *
 * @param {Error} error Error thrown by a backend.
 * @return {boolean} True for rate limits, server faults and network blips.
 * @private
 */
function isRetryable_(error) {
  if (!error) return false;
  const status = error.status ?? error.statusCode ?? error.response?.status;
  if (typeof status === 'number') return RETRYABLE_STATUSES.has(status);
  if (error.code && RETRYABLE_CODES.has(error.code)) return true;
  return false;
}

/**
 * Backend-agnostic embedding client with batching, caching and retry.
 *
 * @class
 */
class EmbeddingClient {
  /**
   * @param {Object} [options] Configuration.
   * @param {string|Function} [options.backend='hash'] `'hash'`, `'aiservice'`,
   *   or an `async (texts, options) => number[][]` function.
   * @param {string} [options.model] Model identifier passed to the backend and
   *   recorded alongside stored vectors. Defaults to `'hash'` for the hash
   *   backend so a model change is always detectable.
   * @param {number} [options.dimensions=384] Vector width. Every vector this
   *   client returns has exactly this length or the call throws.
   * @param {Object} [options.aiservice] AI service instance exposing
   *   `embed(input, options)`. Required for the `aiservice` backend.
   * @param {Function} [options.embed] Shorthand for a function backend.
   * @param {Object} [options.cache] Cache with `get(key)` and `put(key, value)`
   *   (a `set` alias is also accepted). Omit to disable caching.
   * @param {number} [options.batchSize=64] Texts per backend call.
   * @param {number} [options.maxRetries=3] Attempts after the first failure.
   * @param {number} [options.retryBaseMs=250] Base for exponential backoff.
   * @param {Object} [dependencies] Injected dependencies.
   * @param {Object} [dependencies.logging] Logging service.
   *
   * @example
   * // Offline, no configuration
   * const client = new EmbeddingClient({ backend: 'hash', dimensions: 384 });
   *
   * @example
   * // Real embeddings through the AI service, cached
   * const client = new EmbeddingClient({
   *   backend: 'aiservice',
   *   model: 'text-embedding-3-small',
   *   dimensions: 384,
   *   aiservice,
   *   cache
   * }, { logging });
   */
  constructor(options = {}, dependencies = {}) {
    this.logger = dependencies.logging || options.logger || null;

    const backend = typeof options.embed === 'function' ? options.embed : (options.backend || 'hash');
    this.backend_ = backend;
    this.backendName_ = typeof backend === 'function' ? 'custom' : String(backend);

    this.dimensions = options.dimensions || DEFAULT_DIMENSIONS;
    this.model = options.model
      || (this.backendName_ === 'hash' ? `hash-${this.dimensions}` : undefined);

    this.aiservice_ = options.aiservice || null;
    this.cache_ = options.cache || null;
    this.batchSize = Math.max(1, options.batchSize || DEFAULT_BATCH_SIZE);
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;

    this.stats = { calls: 0, cacheHits: 0, cacheMisses: 0, failures: 0, retries: 0 };
    this.lastError = null;

    if (this.backendName_ === 'aiservice' && !this.aiservice_) {
      throw new Error(
        'EmbeddingClient: backend "aiservice" requires an aiservice instance in options.aiservice'
      );
    }
  }

  /**
   * Describes the active configuration. Surfaced by the semantic status
   * endpoint and written into the vector store's metadata, where it is what
   * makes a model change detectable on load.
   *
   * @return {{backend: string, model: string, dimensions: number,
   *   cached: boolean, batchSize: number}}
   */
  describe() {
    return {
      backend: this.backendName_,
      model: this.model,
      dimensions: this.dimensions,
      cached: !!this.cache_,
      batchSize: this.batchSize
    };
  }

  /**
   * Embed a single text.
   *
   * @param {string} text Text to embed.
   * @return {Promise<Float32Array|null>} Unit-length vector, or `null` when the
   *   backend failed permanently.
   *
   * @example
   * const vector = await client.embed('how do I reset my password');
   */
  async embed(text) {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  /**
   * Embed many texts, returning results positionally aligned with the input.
   *
   * Cached entries are served without touching the backend; the remainder is
   * split into batches of `batchSize`. A batch that fails permanently
   * contributes `null`s and is logged, leaving other batches unaffected.
   *
   * @param {Array<string>} texts Texts to embed.
   * @return {Promise<Array<Float32Array|null>>} One entry per input text.
   * @throws {Error} If a backend returns vectors of the wrong width.
   *
   * @example
   * const vectors = await client.embedBatch(docs.map(d => d.body));
   */
  async embedBatch(texts) {
    if (!Array.isArray(texts)) {
      throw new Error('embedBatch requires an array of texts');
    }
    if (texts.length === 0) return [];

    const results = new Array(texts.length).fill(null);
    const pending = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i] == null ? '' : String(texts[i]);
      if (text.trim() === '') continue; // empty text has no direction; leave null

      const cached = await this.readCache_(text);
      if (cached) {
        results[i] = cached;
        this.stats.cacheHits++;
        continue;
      }
      this.stats.cacheMisses++;
      pending.push({ index: i, text });
    }

    for (let offset = 0; offset < pending.length; offset += this.batchSize) {
      const batch = pending.slice(offset, offset + this.batchSize);
      let vectors;
      try {
        vectors = await this.callBackendWithRetry_(batch.map(entry => entry.text));
      } catch (error) {
        // A width mismatch is a configuration fault and must not be swallowed.
        if (error?.isDimensionMismatch) throw error;
        this.stats.failures += batch.length;
        this.lastError = error?.message || String(error);
        this.logger?.warn?.(
          `[EmbeddingClient] Embedding batch failed, ${batch.length} document(s) left unembedded`,
          { error: this.lastError, backend: this.backendName_, model: this.model }
        );
        continue;
      }

      for (let i = 0; i < batch.length; i++) {
        const vector = vectors[i];
        if (!vector) continue;
        results[batch[i].index] = vector;
        await this.writeCache_(batch[i].text, vector);
      }
    }

    return results;
  }

  /**
   * Invoke the backend, retrying transient failures with exponential backoff.
   *
   * @param {Array<string>} texts Texts for one batch.
   * @return {Promise<Array<Float32Array|null>>}
   * @private
   */
  async callBackendWithRetry_(texts) {
    let attempt = 0;
    for (;;) {
      try {
        this.stats.calls++;
        return await this.callBackend_(texts);
      } catch (error) {
        if (error?.isDimensionMismatch) throw error;
        if (attempt >= this.maxRetries || !isRetryable_(error)) throw error;
        attempt++;
        this.stats.retries++;
        const delay = this.retryBaseMs * Math.pow(2, attempt - 1);
        this.logger?.debug?.(
          `[EmbeddingClient] Retry ${attempt}/${this.maxRetries} in ${delay}ms`,
          { error: error?.message, backend: this.backendName_ }
        );
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Dispatch one batch to the configured backend and normalize the result.
   *
   * @param {Array<string>} texts Texts for one batch.
   * @return {Promise<Array<Float32Array|null>>}
   * @private
   */
  async callBackend_(texts) {
    if (this.backendName_ === 'hash') {
      return texts.map(text => hashEmbed(text, this.dimensions));
    }

    let raw;
    if (typeof this.backend_ === 'function') {
      raw = await this.backend_(texts, { model: this.model, dimensions: this.dimensions });
    } else if (this.backendName_ === 'aiservice') {
      const response = await this.aiservice_.embed(texts, {
        model: this.model,
        dimensions: this.dimensions
      });
      raw = Array.isArray(response) ? response : (response?.vectors ?? response?.embeddings);
    } else {
      throw new Error(`EmbeddingClient: unknown backend "${this.backendName_}"`);
    }

    if (!Array.isArray(raw)) {
      throw new Error(
        `EmbeddingClient: backend "${this.backendName_}" returned ${typeof raw}, expected an array of vectors`
      );
    }

    return raw.map(vector => this.toVector_(vector));
  }

  /**
   * Coerce one backend result into a normalized Float32Array of the configured
   * width.
   *
   * @param {Array<number>|Float32Array|null} vector Raw backend vector.
   * @return {Float32Array|null}
   * @throws {Error} Tagged with `isDimensionMismatch` when the width is wrong.
   * @private
   */
  toVector_(vector) {
    if (vector == null) return null;
    if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
      throw new Error('EmbeddingClient: backend returned a non-vector entry');
    }
    if (vector.length !== this.dimensions) {
      const error = new Error(
        `EmbeddingClient: backend returned ${vector.length}-dimensional vectors but this client is `
        + `configured for ${this.dimensions}. Vectors from different models are not comparable — `
        + 'align options.dimensions with the model, and re-embed any existing index.'
      );
      error.isDimensionMismatch = true;
      throw error;
    }
    return normalize(Float32Array.from(vector));
  }

  /**
   * Cache key for a text under the current model. Keyed on content, so
   * re-indexing an unchanged document costs nothing.
   *
   * @param {string} text
   * @return {string}
   * @private
   */
  cacheKey_(text) {
    const digest = crypto.createHash('sha256')
      .update(`${this.model}:${this.dimensions}:${text}`)
      .digest('hex');
    return `embedding:${digest}`;
  }

  /**
   * Read a vector from the cache, tolerating the array form a JSON-backed
   * cache round-trips through.
   *
   * @param {string} text
   * @return {Promise<Float32Array|null>}
   * @private
   */
  async readCache_(text) {
    if (!this.cache_?.get) return null;
    try {
      const stored = await this.cache_.get(this.cacheKey_(text));
      if (!stored) return null;
      const values = Array.isArray(stored) ? stored : stored.vector;
      if (!Array.isArray(values) || values.length !== this.dimensions) return null;
      return Float32Array.from(values);
    } catch (error) {
      this.logger?.debug?.('[EmbeddingClient] Cache read failed', { error: error.message });
      return null;
    }
  }

  /**
   * Write a vector to the cache as a plain array so file- and Redis-backed
   * providers can serialize it.
   *
   * @param {string} text
   * @param {Float32Array} vector
   * @return {Promise<void>}
   * @private
   */
  async writeCache_(text, vector) {
    const write = this.cache_?.put || this.cache_?.set;
    if (!write) return;
    try {
      await write.call(this.cache_, this.cacheKey_(text), Array.from(vector));
    } catch (error) {
      this.logger?.debug?.('[EmbeddingClient] Cache write failed', { error: error.message });
    }
  }
}

module.exports = {
  EmbeddingClient,
  hashEmbed,
  chunkText,
  normalize,
  fnv1a
};
