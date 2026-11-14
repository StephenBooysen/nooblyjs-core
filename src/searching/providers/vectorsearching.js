/**
 * @fileoverview Vector Search Service (dense-embedding search engine).
 *
 * The semantic counterpart to `searching.js`. Where that provider matches
 * *words*, this one matches *meaning*: documents are embedded into dense
 * vectors at index time and a query is answered by cosine similarity, so
 * "how do I reset my password" retrieves a document titled "Credential
 * recovery procedure" even though the two share no vocabulary.
 *
 * This is a deliberately standalone provider rather than a flag on the token
 * engine. The two are chosen at construction (`type: 'vector'` vs the default)
 * and neither depends on the other, so the semantic path can evolve — different
 * scoring, different persistence, different tuning — without any risk to the
 * BM25 engine that existing callers rely on. The cost is duplicated lexical
 * machinery, which is accepted and intentional: the copy below exists purely to
 * serve this provider's own `hybrid` and `keyword` modes.
 *
 * Three search modes, all through the same `search()` call:
 *
 * - `semantic` (default) — pure vector similarity.
 * - `hybrid`             — BM25 and vector rankings fused by Reciprocal Rank
 *                          Fusion, which is scale-free and needs no tuning.
 * - `keyword`            — BM25 only, for comparison and for queries where
 *                          exact terms are what matter.
 *
 * Embeddings come from a pluggable backend. The default (`hash`) is
 * deterministic, offline and free, so the provider works with no API key
 * configured; point it at the AI service for real semantics.
 *
 * Writes do not block on the network: a document is lexically indexed
 * synchronously and its embedding is queued, batched and applied shortly
 * after. Call `flushEmbeddings()` when you need determinism — in tests, in bulk
 * imports, or before serving a query that must see everything just written.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 2026-08-27
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

const analytics = require('../modules/analytics');
const { parseQuotedPhrases, normalizeForPhrase } = require('../modules/queryParser');
const { EmbeddingClient, chunkText } = require('../modules/embeddings');
const { VectorStore } = require('../modules/vectorStore');
const { fuse } = require('../modules/fusion');

/**
 * Disk layout version for this provider. Independent of the token engine's
 * `DISK_FORMAT_VERSION` — the two write different files and must never read
 * each other's.
 */
const DISK_FORMAT_VERSION = '1.0.0';

/** Written into meta.json so a directory shared with another provider is caught. */
const PROVIDER_TAG = 'vector';

const SYNTHETIC_FIELD = '_all';
const CHUNK_DELIMITER = '#chunk-';

/** Modes accepted by `search()`. */
const MODES = new Set(['semantic', 'hybrid', 'keyword']);

/**
 * Default similarity floor.
 *
 * Not a relevance threshold — a correctness one. Cosine similarity of 0 means
 * the query and the document are orthogonal: no relationship whatsoever. With a
 * floor of exactly 0 those documents are still returned (the comparison is
 * `score < minScore`), so every search would end with a tail of completely
 * unrelated results. This floor says only "must be positively similar"; raise it
 * to impose an actual relevance bar.
 */
const DEFAULT_MIN_SCORE = 1e-6;

const DEFAULT_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
]);

/**
 * Default tokenizer for the lexical side: lowercase, strip non-word characters
 * except hyphens, split on whitespace.
 *
 * @param {string} text
 * @return {Array<string>}
 */
function defaultTokenize(text) {
  if (text == null) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Build the default term processor honoring minimum length and stop words.
 *
 * @param {number} minLength
 * @param {Set<string>} stopWords
 * @return {function(string): (string|null)}
 */
function makeDefaultProcessTerm(minLength, stopWords) {
  return (term) => {
    if (!term || term.length < minLength) return null;
    if (stopWords.has(term)) return null;
    return term;
  };
}

/**
 * Default field extractor: dot-path access for nested fields. The synthetic
 * `_all` field stringifies the whole document.
 *
 * @param {Object} document
 * @param {string} fieldName
 * @return {*}
 */
function defaultExtractField(document, fieldName) {
  if (fieldName === SYNTHETIC_FIELD) {
    return JSON.stringify(document);
  }
  return fieldName.split('.').reduce(
    (obj, key) => (obj == null ? obj : obj[key]),
    document
  );
}

/**
 * Dense-vector search provider with optional BM25 fusion, multiple named
 * indexes, background embedding and disk persistence.
 *
 * @class
 */
class VectorSearchService {
  /**
   * @param {Object} [options] Configuration options.
   * @param {Array<string>} [options.fields] Field names to index and embed. If
   *   absent, the whole document is used (see `buildEmbedText_`).
   * @param {Array<string>} [options.storeFields] Fields to return in results.
   *   If absent, the full source object is returned via `obj`.
   * @param {string} [options.idField='id'] Document id field for `addAll`,
   *   `replace` and `removeAll`.
   * @param {string} [options.defaultIndex='default'] Default container name.
   * @param {Object} [options.embedding] Embedding backend configuration, passed
   *   through to `EmbeddingClient`.
   * @param {string} [options.embedding.backend='hash'] `'hash'`, `'aiservice'`
   *   or a custom `async (texts, options) => number[][]`.
   * @param {string} [options.embedding.model] Model identifier. Recorded with
   *   the vectors so a model change invalidates them on load rather than
   *   silently mixing incomparable data.
   * @param {number} [options.embedding.dimensions=384] Vector width.
   * @param {Object} [options.embedding.aiservice] AI service instance for the
   *   `aiservice` backend.
   * @param {Object} [options.embedding.cache] Cache for embeddings, keyed by
   *   content hash, so re-indexing an unchanged document costs nothing.
   * @param {Object} [options.chunk] Chunking for long documents.
   * @param {number} [options.chunk.maxChars=1200] Target chunk length.
   * @param {number} [options.chunk.overlap=150] Overlap between chunks.
   * @param {string} [options.mode='semantic'] Default search mode.
   * @param {string} [options.fusion='rrf'] Default hybrid fusion strategy,
   *   `'rrf'` or `'weighted'`.
   * @param {number} [options.alpha=0.5] Lexical weight for weighted fusion.
   * @param {number} [options.k=50] Per-branch candidate depth before fusion.
   * @param {number} [options.minScore=1e-6] Minimum cosine similarity to
   *   return. The default only excludes documents with zero or negative
   *   similarity — orthogonal to the query, and never a legitimate result.
   *   Raise it to impose a real relevance bar.
   * @param {boolean} [options.restrictToLexical=false] In hybrid mode, score
   *   only the documents BM25 already surfaced. Turns the vector branch into a
   *   reranker — the cheap way to stay fast on a very large index.
   * @param {number} [options.maxVectorDocuments=100000] Soft ceiling on
   *   embedded documents per container; crossing it logs a warning.
   * @param {boolean} [options.autoEmbed=true] Embed in the background on write.
   *   Set false to embed only when `flushEmbeddings()` is called.
   * @param {{k1: number, b: number}} [options.bm25] BM25 tuning for the lexical
   *   side. Defaults k1=1.2, b=0.75.
   * @param {Object} [options.searchOptions] Per-instance search defaults.
   * @param {boolean|Object} [options.snippet] Match-centred context snippets on
   *   results. Raw text is retained regardless (embeddings need it), so this
   *   only controls whether snippets are built.
   * @param {Set<string>|Array<string>} [options.stopWords] Override stop words.
   * @param {number} [options.minTokenLength=3] Minimum indexable token length.
   * @param {number} [options.maxTokensPerDocument=500] Per-field token cap.
   * @param {number} [options.maxTotalTokens=500000] Total token cap per container.
   * @param {string} [options.indexDir] Directory for disk persistence.
   * @param {number} [options.diskTTLHours=24] TTL for on-disk indexes.
   * @param {EventEmitter} [eventEmitter] Event emitter.
   * @param {Object} [dependencies] Injected dependencies (logging, caching, …).
   *
   * @example
   * // Offline: no API key, no network, deterministic
   * const search = new VectorSearchService({ fields: ['title', 'body'] });
   *
   * @example
   * // Real embeddings through the AI service, hybrid by default
   * const search = new VectorSearchService({
   *   fields: ['title', 'body'],
   *   mode: 'hybrid',
   *   embedding: {
   *     backend: 'aiservice',
   *     model: 'text-embedding-3-small',
   *     dimensions: 384,
   *     aiservice
   *   }
   * }, eventEmitter, { logging });
   */
  constructor(options = {}, eventEmitter, dependencies = {}) {
    this.logger = dependencies.logging || null;
    this.eventEmitter_ = eventEmitter;
    this.dependencies = dependencies;

    // ── Lexical configuration (duplicated from the token engine on purpose) ──
    this.fields_ = Array.isArray(options.fields) && options.fields.length > 0
      ? [...options.fields]
      : [SYNTHETIC_FIELD];
    this.syntheticAllField_ = this.fields_.length === 1 && this.fields_[0] === SYNTHETIC_FIELD;
    this.storeFields_ = Array.isArray(options.storeFields) ? [...options.storeFields] : null;
    this.idField_ = options.idField || 'id';
    this.defaultIndex_ = this.normalizeIndexName_(options.defaultIndex);

    this.minTokenLength = options.minTokenLength || 3;
    this.stopWords = options.stopWords instanceof Set
      ? options.stopWords
      : (Array.isArray(options.stopWords) ? new Set(options.stopWords) : DEFAULT_STOP_WORDS);
    this.tokenizeFn_ = typeof options.tokenize === 'function' ? options.tokenize : defaultTokenize;
    this.processTermFn_ = typeof options.processTerm === 'function'
      ? options.processTerm
      : makeDefaultProcessTerm(this.minTokenLength, this.stopWords);
    this.extractFieldFn_ = typeof options.extractField === 'function'
      ? options.extractField
      : defaultExtractField;

    this.bm25_ = {
      k1: options.bm25?.k1 ?? 1.2,
      b: options.bm25?.b ?? 0.75
    };

    this.maxTokensPerDocument = options.maxTokensPerDocument || 500;
    this.maxTotalTokens = options.maxTotalTokens || 500000;

    // ── Vector configuration ────────────────────────────────────────────────
    const embedding = options.embedding || {};
    this.embedder = new EmbeddingClient({
      backend: embedding.backend || 'hash',
      model: embedding.model,
      dimensions: embedding.dimensions || 384,
      aiservice: embedding.aiservice || dependencies.aiservice,
      embed: embedding.embed,
      cache: embedding.cache || dependencies.caching,
      batchSize: embedding.batchSize,
      maxRetries: embedding.maxRetries,
      retryBaseMs: embedding.retryBaseMs
    }, dependencies);

    this.dimensions = this.embedder.dimensions;
    this.chunk_ = {
      maxChars: options.chunk?.maxChars ?? 1200,
      overlap: options.chunk?.overlap ?? 150
    };
    this.maxVectorDocuments = options.maxVectorDocuments || 100000;
    this.autoEmbed = options.autoEmbed !== false;

    // ── Search defaults ─────────────────────────────────────────────────────
    this.mode_ = MODES.has(options.mode) ? options.mode : 'semantic';
    this.fusion_ = options.fusion === 'weighted' ? 'weighted' : 'rrf';
    this.alpha_ = typeof options.alpha === 'number' ? options.alpha : 0.5;
    this.k_ = Number.isInteger(options.k) && options.k > 0 ? options.k : 50;
    this.minScore_ = typeof options.minScore === 'number' ? options.minScore : DEFAULT_MIN_SCORE;
    this.restrictToLexical_ = options.restrictToLexical === true;
    this.searchOptions_ = options.searchOptions || {};

    this.snippet_ = this.normalizeSnippetOptions_(options.snippet);

    // ── Storage ─────────────────────────────────────────────────────────────
    this.containers = new Map();
    this.createContainer_(this.defaultIndex_);

    this.indexDir = options.indexDir || null;
    this.diskTTLHours = options.diskTTLHours || 24;

    // ── Background embedding queue ──────────────────────────────────────────
    /** @type {Map<string, Map<string, string>>} container → (docId → text). */
    this.pending_ = new Map();
    this.drainTimer_ = null;
    this.draining_ = null;
    this.drainDelayMs_ = options.drainDelayMs ?? 0;

    this.isIndexing = false;
    this.lastIndexTime = null;
    this.lastEmbedError = null;

    this.settings = {
      description:
        'Dense-vector semantic search with cosine similarity, optional BM25 fusion and autoSuggest',
      list: [
        { setting: 'mode', type: 'select', values: ['semantic', 'hybrid', 'keyword'] },
        { setting: 'fusion', type: 'select', values: ['rrf', 'weighted'] },
        { setting: 'alpha', type: 'number', values: [String(this.alpha_)] },
        { setting: 'k', type: 'number', values: [String(this.k_)] },
        { setting: 'minScore', type: 'number', values: [String(this.minScore_)] },
        { setting: 'backend', type: 'string', values: [this.embedder.describe().backend] },
        { setting: 'model', type: 'string', values: [String(this.embedder.model)] },
        { setting: 'dimensions', type: 'number', values: [String(this.dimensions)] }
      ]
    };
  }

  // ─── Container management ────────────────────────────────────────

  /**
   * Create a container (named index) if it does not exist. Each carries both a
   * lexical inverted index and its own vector store.
   *
   * @param {string} name
   * @private
   */
  createContainer_(name) {
    if (this.containers.has(name)) return;
    this.containers.set(name, {
      // token -> field -> docId -> termFrequency
      tokens: new Map(),
      // docId -> { storedFields, sourceDoc, fieldTokens, fieldLengths, text, isIndexed }
      documents: new Map(),
      // fieldName -> { totalLength, docCount }
      fieldStats: new Map(),
      vectors: new VectorStore({
        dimensions: this.dimensions,
        model: this.embedder.model
      })
    });
  }

  /**
   * @param {string=} name
   * @return {{name: string, container: Object}}
   * @private
   */
  getContainer_(name) {
    const resolved = this.normalizeIndexName_(name);
    this.createContainer_(resolved);
    return { name: resolved, container: this.containers.get(resolved) };
  }

  /**
   * @param {string=} searchContainer
   * @return {string}
   * @private
   */
  normalizeIndexName_(searchContainer) {
    if (typeof searchContainer === 'string') {
      const trimmed = searchContainer.trim();
      if (trimmed) {
        // Container names are persisted to disk as a directory segment under
        // this.indexDir (see _saveContainerToDisk). Reject path separators and
        // traversal so a name like "../../etc" cannot escape the index dir.
        if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
          throw new Error('Invalid container name: must not contain path separators or traversal segments');
        }
        return trimmed;
      }
    }
    return this.defaultIndex_ || 'default';
  }

  /**
   * Resolve the third positional argument, which may be a container name
   * (legacy) or an options object.
   *
   * @param {string|Object=} arg
   * @return {Object}
   * @private
   */
  resolveContainerArg_(arg) {
    if (typeof arg === 'string') return { containerName: this.normalizeIndexName_(arg) };
    if (arg && typeof arg === 'object') return { containerName: this.defaultIndex_, ...arg };
    return { containerName: this.defaultIndex_ };
  }

  // ─── Tokenization helpers ────────────────────────────────────────

  /**
   * Tokenize text using the configured tokenizer and term processor.
   *
   * @param {string} text
   * @param {string} [fieldName]
   * @return {Array<string>} Unique processed tokens.
   */
  tokenize(text, fieldName) {
    const raw = this.tokenizeFn_(text, fieldName);
    const out = [];
    const seen = new Set();
    for (const t of raw) {
      const processed = this.processTermFn_(t, fieldName);
      if (!processed || seen.has(processed)) continue;
      seen.add(processed);
      out.push(processed);
    }
    return out;
  }

  /**
   * Tokenize and count term frequencies.
   *
   * @param {string} text
   * @param {string} [fieldName]
   * @return {{terms: Array<string>, tf: Map<string, number>}}
   * @private
   */
  tokenizeWithFrequency_(text, fieldName) {
    const raw = this.tokenizeFn_(text, fieldName);
    const tf = new Map();
    const ordered = [];
    for (const t of raw) {
      const processed = this.processTermFn_(t, fieldName);
      if (!processed) continue;
      ordered.push(processed);
      tf.set(processed, (tf.get(processed) || 0) + 1);
    }
    return { terms: ordered, tf };
  }

  // ─── Field extraction helpers ────────────────────────────────────

  /**
   * @param {Object} document
   * @param {string} fieldName
   * @return {string}
   * @private
   */
  extractFieldValue_(document, fieldName) {
    const value = this.extractFieldFn_(document, fieldName);
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(v => (v == null ? '' : String(v))).join(' ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * @param {Object} document
   * @return {Object}
   * @private
   */
  buildStoredFields_(document) {
    if (!this.storeFields_) return { ...document };
    const out = {};
    for (const field of this.storeFields_) {
      const value = field.includes('.')
        ? field.split('.').reduce((o, k) => (o == null ? o : o[k]), document)
        : document[field];
      if (value !== undefined) out[field] = value;
    }
    return out;
  }

  /**
   * Build the natural-language text an embedding model should see.
   *
   * This deliberately differs from the lexical path. With no `fields`
   * configured the token engine indexes `JSON.stringify(document)`, which is
   * fine for a tokenizer that discards punctuation but poor input for an
   * embedding model — braces, quotes and key names dilute the meaning. So this
   * walks the document and joins its human-readable leaf values instead.
   *
   * @param {Object} document
   * @return {string} Text to embed.
   * @private
   */
  buildEmbedText_(document) {
    if (!this.syntheticAllField_) {
      const parts = [];
      for (const field of this.fields_) {
        const value = this.extractFieldValue_(document, field);
        if (value) parts.push(value);
      }
      return parts.join('\n');
    }

    const parts = [];
    const visit = (value, depth) => {
      if (value == null || depth > 4) return;
      if (typeof value === 'string') { if (value.trim()) parts.push(value); return; }
      if (typeof value === 'number' || typeof value === 'boolean') { parts.push(String(value)); return; }
      if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
      if (typeof value === 'object') { for (const item of Object.values(value)) visit(item, depth + 1); }
    };
    visit(document, 0);
    return parts.join('\n');
  }

  // ─── Document operations ────────────────────────────────────────

  /**
   * Add a document. Lexical indexing is synchronous; the embedding is queued
   * and applied in the background.
   *
   * @param {string} key Document id.
   * @param {Object} jsonObject Document body.
   * @param {string|Object} [containerOrOptions] Container name or options.
   * @return {Promise<boolean>} True when indexed; false when the key exists.
   * @throws {Error} On an invalid key or document.
   *
   * @example
   * await search.add('doc-1', { title: 'Credential recovery', body: '…' });
   */
  async add(key, jsonObject, containerOrOptions = this.defaultIndex_) {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new Error('Invalid key: must be a non-empty string');
    }
    if (!jsonObject || typeof jsonObject !== 'object' || Array.isArray(jsonObject)) {
      throw new Error('Invalid jsonObject: must be a non-null object');
    }

    const { containerName } = this.resolveContainerArg_(containerOrOptions);
    const { name, container } = this.getContainer_(containerName);

    if (container.documents.has(key)) {
      this.eventEmitter_?.emit('search:add:error', {
        jsonObject, key, searchContainer: name, error: 'Key already exists.'
      });
      return false;
    }

    this.indexDocumentFields_(key, jsonObject, container, name);
    this.enqueueEmbed_(name, key, this.buildEmbedText_(jsonObject));
    analytics.trackAdd(name);

    this.eventEmitter_?.emit('search:add', { jsonObject, key, searchContainer: name });
    return true;
  }

  /**
   * Batch-add documents, reading each id from `idField`.
   *
   * @param {Array<Object>} documents
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<{added: number, skipped: number}>}
   */
  async addAll(documents, containerOrOptions = this.defaultIndex_) {
    if (!Array.isArray(documents)) {
      throw new Error('addAll requires an array of documents');
    }
    let added = 0, skipped = 0;
    for (const doc of documents) {
      const id = doc && doc[this.idField_];
      if (id == null) { skipped++; continue; }
      if (await this.add(String(id), doc, containerOrOptions)) added++; else skipped++;
    }
    return { added, skipped };
  }

  /**
   * Replace a document, inserting it when absent. Id is read from `idField`.
   *
   * @param {Object} document
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<boolean>}
   */
  async replace(document, containerOrOptions = this.defaultIndex_) {
    if (!document || typeof document !== 'object') {
      throw new Error('replace requires a document object');
    }
    const id = document[this.idField_];
    if (id == null) {
      throw new Error(`replace: document missing idField '${this.idField_}'`);
    }
    const key = String(id);
    const { containerName } = this.resolveContainerArg_(containerOrOptions);
    await this.remove(key, containerName);
    return this.add(key, document, containerName);
  }

  /**
   * Remove a document and its vectors.
   *
   * @param {string} key
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<boolean>}
   */
  async remove(key, containerOrOptions = this.defaultIndex_) {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new Error('Invalid key: must be a non-empty string');
    }
    const { containerName } = this.resolveContainerArg_(containerOrOptions);
    return this.removeDocument(key, containerName);
  }

  /**
   * MiniSearch-compatible alias for `remove`.
   *
   * @param {string} id
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<boolean>}
   */
  async discard(id, containerOrOptions = this.defaultIndex_) {
    return this.remove(id, containerOrOptions);
  }

  /**
   * Remove many documents, by id or by document.
   *
   * @param {Array<string|Object>} idsOrDocuments
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<{removed: number, missing: number}>}
   */
  async removeAll(idsOrDocuments, containerOrOptions = this.defaultIndex_) {
    if (!Array.isArray(idsOrDocuments)) {
      throw new Error('removeAll requires an array');
    }
    let removed = 0, missing = 0;
    for (const item of idsOrDocuments) {
      let id;
      if (typeof item === 'string' || typeof item === 'number') id = String(item);
      else if (item && typeof item === 'object') id = String(item[this.idField_]);
      else { missing++; continue; }
      if (await this.remove(id, containerOrOptions)) removed++; else missing++;
    }
    return { removed, missing };
  }

  /**
   * Index a document across all configured fields into the lexical index.
   * Raw text is always retained — the embedder needs it to chunk and re-embed.
   *
   * @param {string} id
   * @param {Object} document
   * @param {Object} container
   * @param {string} containerName
   * @private
   */
  indexDocumentFields_(id, document, container, containerName) {
    const fieldTokens = new Map();
    const fieldLengths = new Map();
    const textParts = [];

    for (const field of this.fields_) {
      const rawValue = this.extractFieldValue_(document, field);
      textParts.push(rawValue);
      const { terms, tf } = this.tokenizeWithFrequency_(rawValue, field);

      let limitedEntries = Array.from(tf.entries());
      if (limitedEntries.length > this.maxTokensPerDocument) {
        limitedEntries = limitedEntries.slice(0, this.maxTokensPerDocument);
      }

      const tokenSetForField = new Set();
      for (const [token, count] of limitedEntries) {
        if (container.tokens.size >= this.maxTotalTokens && !container.tokens.has(token)) {
          this.logger?.warn(
            `[${this.constructor.name}] Token cap (${this.maxTotalTokens}) reached for ${containerName}`
          );
          break;
        }
        let byField = container.tokens.get(token);
        if (!byField) { byField = new Map(); container.tokens.set(token, byField); }
        let docMap = byField.get(field);
        if (!docMap) { docMap = new Map(); byField.set(field, docMap); }
        docMap.set(id, count);
        tokenSetForField.add(token);
      }

      fieldTokens.set(field, tokenSetForField);
      fieldLengths.set(field, terms.length);

      const stats = container.fieldStats.get(field) || { totalLength: 0, docCount: 0 };
      stats.totalLength += terms.length;
      stats.docCount += 1;
      container.fieldStats.set(field, stats);
    }

    container.documents.set(id, {
      storedFields: this.buildStoredFields_(document),
      sourceDoc: this.storeFields_ ? null : document,
      fieldTokens,
      fieldLengths,
      // Always retained: the embedding queue reads it, and re-embedding after a
      // model change would otherwise be impossible without re-crawling.
      text: this.syntheticAllField_ ? this.buildEmbedText_(document) : textParts.join('\n'),
      isIndexed: true
    });

    this.lastIndexTime = new Date();
  }

  /**
   * Remove a document, its postings, its stats and every vector it owns
   * (including chunk children).
   *
   * @param {string} id
   * @param {string} [containerName]
   * @return {boolean}
   */
  removeDocument(id, containerName = this.defaultIndex_) {
    const { name, container } = this.getContainer_(containerName);
    const docInfo = container.documents.get(id);

    // Drop any queued embedding so a removed document cannot be resurrected by
    // a drain that was already in flight.
    this.pending_.get(name)?.delete(id);
    const vectorsRemoved = container.vectors.removeDocument(id);

    if (!docInfo) return vectorsRemoved > 0;

    for (const [field, tokenSet] of docInfo.fieldTokens) {
      for (const token of tokenSet) {
        const byField = container.tokens.get(token);
        if (!byField) continue;
        const docMap = byField.get(field);
        if (!docMap) continue;
        docMap.delete(id);
        if (docMap.size === 0) byField.delete(field);
        if (byField.size === 0) container.tokens.delete(token);
      }
      const stats = container.fieldStats.get(field);
      if (stats) {
        stats.totalLength -= (docInfo.fieldLengths.get(field) || 0);
        stats.docCount -= 1;
        if (stats.docCount <= 0) container.fieldStats.delete(field);
        else container.fieldStats.set(field, stats);
      }
    }

    container.documents.delete(id);
    analytics.trackDelete(name);

    this.eventEmitter_?.emit('search:remove', { key: id, searchContainer: name });
    return true;
  }

  /**
   * Indexer-facing upsert for crawler consumers that deal in
   * `(id, content, metadata)` tuples. Indexes raw text into the synthetic
   * `_all` field regardless of configured fields, and queues the same text for
   * embedding.
   *
   * @param {string} id
   * @param {string} content Raw document text.
   * @param {Object} [metadata] Stored alongside the document.
   * @param {string} [containerName]
   * @return {Promise<boolean>}
   */
  async indexDocument(id, content, metadata = {}, containerName = this.defaultIndex_) {
    if (!id || typeof id !== 'string') {
      throw new Error('Invalid id: must be a non-empty string');
    }
    const { name, container } = this.getContainer_(containerName);
    if (container.documents.has(id)) this.removeDocument(id, name);

    const { terms, tf } = this.tokenizeWithFrequency_(content || '', SYNTHETIC_FIELD);
    const limited = Array.from(tf.entries()).slice(0, this.maxTokensPerDocument);
    const tokenSet = new Set();
    for (const [token, count] of limited) {
      if (container.tokens.size >= this.maxTotalTokens && !container.tokens.has(token)) break;
      let byField = container.tokens.get(token);
      if (!byField) { byField = new Map(); container.tokens.set(token, byField); }
      let docMap = byField.get(SYNTHETIC_FIELD);
      if (!docMap) { docMap = new Map(); byField.set(SYNTHETIC_FIELD, docMap); }
      docMap.set(id, count);
      tokenSet.add(token);
    }

    const stats = container.fieldStats.get(SYNTHETIC_FIELD) || { totalLength: 0, docCount: 0 };
    stats.totalLength += terms.length;
    stats.docCount += 1;
    container.fieldStats.set(SYNTHETIC_FIELD, stats);

    container.documents.set(id, {
      storedFields: { ...metadata },
      sourceDoc: metadata.object || null,
      fieldTokens: new Map([[SYNTHETIC_FIELD, tokenSet]]),
      fieldLengths: new Map([[SYNTHETIC_FIELD, terms.length]]),
      excerpt: this.generateExcerpt_(content),
      text: String(content || ''),
      isIndexed: true
    });

    this.enqueueEmbed_(name, id, String(content || ''));
    this.lastIndexTime = new Date();
    analytics.trackAdd(name);
    this.eventEmitter_?.emit('search:add', {
      key: id, searchContainer: name, tokenCount: limited.length
    });
    return true;
  }

  // ─── Embedding queue ────────────────────────────────────────────

  /**
   * Queue a document for embedding.
   *
   * Writes stay fast: the document is already lexically searchable, and its
   * vector lands a moment later. `flushEmbeddings()` makes the wait explicit
   * where determinism matters.
   *
   * @param {string} containerName
   * @param {string} id
   * @param {string} text
   * @private
   */
  enqueueEmbed_(containerName, id, text) {
    if (!text || !text.trim()) return;
    let queue = this.pending_.get(containerName);
    if (!queue) { queue = new Map(); this.pending_.set(containerName, queue); }
    queue.set(id, text);
    if (this.autoEmbed) this.scheduleDrain_();
  }

  /**
   * Schedule a background drain, if one is not already pending or running.
   *
   * @private
   */
  scheduleDrain_() {
    if (this.drainTimer_ || this.draining_) return;
    this.drainTimer_ = setTimeout(() => {
      this.drainTimer_ = null;
      this.drain_().catch(() => { /* recorded on lastEmbedError */ });
    }, this.drainDelayMs_);
    // Never hold the process (or a test runner) open for a background embed.
    this.drainTimer_.unref?.();
  }

  /**
   * @return {number} Documents awaiting embedding across all containers.
   * @private
   */
  pendingCount_(containerName) {
    if (containerName) return this.pending_.get(containerName)?.size || 0;
    let total = 0;
    for (const queue of this.pending_.values()) total += queue.size;
    return total;
  }

  /**
   * Drain the queue until empty, coalescing concurrent callers onto one run.
   *
   * @return {Promise<void>}
   * @private
   */
  drain_() {
    if (this.draining_) return this.draining_;
    this.draining_ = (async () => {
      try {
        while (this.pendingCount_() > 0) await this.drainOnce_();
      } finally {
        this.draining_ = null;
      }
    })();
    return this.draining_;
  }

  /**
   * Embed one container's queued documents in a single batched pass.
   *
   * @return {Promise<void>}
   * @private
   */
  async drainOnce_() {
    const entry = Array.from(this.pending_.entries()).find(([, queue]) => queue.size > 0);
    if (!entry) return;
    const [containerName, queue] = entry;

    const batch = Array.from(queue.entries());
    queue.clear();

    const { name, container } = this.getContainer_(containerName);

    // Expand documents into chunks, keeping each chunk's parent id so a long
    // document is scored at its best passage rather than as a diluted average.
    const rows = [];
    for (const [docId, text] of batch) {
      // A document removed while queued must not be resurrected.
      if (!container.documents.has(docId)) continue;
      const chunks = chunkText(text, this.chunk_);
      if (chunks.length === 0) continue;
      if (chunks.length === 1) {
        rows.push({ id: docId, parentId: docId, text: chunks[0].text });
      } else {
        for (const chunk of chunks) {
          rows.push({
            id: `${docId}${CHUNK_DELIMITER}${chunk.index}`,
            parentId: docId,
            text: chunk.text
          });
        }
      }
    }
    if (rows.length === 0) return;

    if (container.vectors.parentCount >= this.maxVectorDocuments) {
      this.logger?.warn(
        `[${this.constructor.name}] Vector ceiling (${this.maxVectorDocuments}) reached for ${name}; `
        + 'new documents are lexically searchable but not embedded'
      );
      return;
    }

    let vectors;
    // The embedder counts texts it could not embed (a failed backend call leaves
    // them null rather than throwing), so the difference is this batch's failures.
    const failuresBefore = this.embedder.stats?.failures ?? 0;
    try {
      vectors = await this.embedder.embedBatch(rows.map(row => row.text));
    } catch (error) {
      // Only a dimension mismatch reaches here — a configuration fault worth
      // surfacing loudly rather than retrying document by document.
      this.lastEmbedError = error.message;
      this.logger?.error(`[${this.constructor.name}] Embedding failed: ${error.message}`);
      this.eventEmitter_?.emit('search:embed:error', {
        searchContainer: name, error: error.message
      });
      return;
    }

    // Replace rather than accumulate: a re-indexed document must not keep the
    // chunks of its previous, longer version.
    const touched = new Set(rows.map(row => row.parentId));
    for (const parentId of touched) container.vectors.removeDocument(parentId);

    let embedded = 0;
    for (let i = 0; i < rows.length; i++) {
      const vector = vectors[i];
      if (!vector) continue;
      container.vectors.upsert(rows[i].id, vector, rows[i].parentId);
      embedded++;
    }

    const failed = Math.max(0, (this.embedder.stats?.failures ?? 0) - failuresBefore);
    if (failed > 0) {
      // Documents left without vectors stay searchable by keyword.
      this.lastEmbedError = this.embedder.lastError || 'Embedding failed';
      this.eventEmitter_?.emit('search:embed:error', {
        searchContainer: name,
        documents: touched.size,
        failed,
        error: this.lastEmbedError
      });
    }
    if (embedded === 0 && failed > 0) return;

    this.eventEmitter_?.emit('search:embed:complete', {
      searchContainer: name,
      documents: touched.size,
      vectors: embedded,
      failed
    });
  }

  /**
   * Wait until every queued document has been embedded.
   *
   * Use this wherever eventual consistency is not acceptable: in tests, at the
   * end of a bulk import, or before a query that must see everything just
   * written.
   *
   * @param {string} [containerName] Unused filter hint; the whole queue is
   *   drained regardless, since batches span containers.
   * @return {Promise<boolean>} True once the queue is empty.
   *
   * @example
   * await search.addAll(documents);
   * await search.flushEmbeddings();
   * const results = await search.search('reset my password');
   */
  async flushEmbeddings(containerName) {
    if (this.drainTimer_) {
      clearTimeout(this.drainTimer_);
      this.drainTimer_ = null;
    }
    await this.drain_();
    // A drain that ran concurrently may have queued more work behind it.
    while (this.pendingCount_(containerName) > 0) await this.drain_();
    return true;
  }

  /**
   * Re-embed documents from their retained text — after a model change, or to
   * backfill an index whose embeddings never completed.
   *
   * @param {string} [containerName] Container to rebuild; all when omitted.
   * @param {Object} [options]
   * @param {boolean} [options.force=false] Re-embed every document, not just
   *   those currently missing a vector.
   * @return {Promise<{queued: number}>}
   *
   * @example
   * await search.reembed('default', { force: true });
   * await search.flushEmbeddings();
   */
  async reembed(containerName, options = {}) {
    const names = containerName
      ? [this.normalizeIndexName_(containerName)]
      : Array.from(this.containers.keys());

    let queued = 0;
    for (const name of names) {
      const container = this.containers.get(name);
      if (!container) continue;
      if (options.force) container.vectors.clear();
      for (const [docId, doc] of container.documents) {
        if (!options.force && container.vectors.has(docId)) continue;
        if (!doc.text) continue;
        this.enqueueEmbed_(name, docId, doc.text);
        queued++;
      }
    }
    return { queued };
  }

  // ─── Search ─────────────────────────────────────────────────────

  /**
   * Search the index.
   *
   * The mode decides which retrievers run. `semantic` compares embeddings,
   * `keyword` scores BM25, `hybrid` runs both and fuses the rankings. Quoted
   * phrases, `filter` and `maxResults` apply identically in every mode — a
   * semantically similar document that does not contain the quoted phrase is
   * still rejected.
   *
   * @param {string} query
   * @param {string|Object} [containerOrOptions] Container name (legacy) or
   *   options: `{ containerName, mode, k, minScore, fusion, alpha,
   *   restrictToLexical, fields, boost, filter, combineWith, maxResults,
   *   quotedPhrases }`.
   * @return {Promise<Array<Object>>} Results with `score`, `lexicalScore`,
   *   `semanticScore` and `matchedBy` alongside the stored fields.
   * @throws {Error} On an empty query or an unknown mode.
   *
   * @example
   * await search.search('reset my password');                        // semantic
   * await search.search('reset my password', { mode: 'hybrid' });
   * await search.search('Oracle "MySQL Enterprise"', { mode: 'hybrid' });
   */
  async search(query, containerOrOptions = this.defaultIndex_) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new Error('Invalid searchTerm: must be a non-empty string');
    }

    const opts = this.mergeSearchOptions_(containerOrOptions);
    const { name, container } = this.getContainer_(opts.containerName);

    const mode = opts.mode || this.mode_;
    if (!MODES.has(mode)) {
      throw new Error(`Unknown search mode "${mode}" — expected 'semantic', 'hybrid' or 'keyword'`);
    }

    const filterFn = typeof opts.filter === 'function' ? opts.filter : null;
    const maxResults = Number.isInteger(opts.maxResults) && opts.maxResults > 0
      ? opts.maxResults
      : null;
    const k = Number.isInteger(opts.k) && opts.k > 0 ? opts.k : this.k_;

    const tokenizeFn = typeof opts.tokenize === 'function' ? opts.tokenize : this.tokenizeFn_;
    const processFn = typeof opts.processTerm === 'function' ? opts.processTerm : this.processTermFn_;

    const { phrases, remainder } = opts.quotedPhrases === false
      ? { phrases: [], remainder: query.trim() }
      : parseQuotedPhrases(query);
    const phraseMatchers = this.buildPhraseMatchers_(phrases, tokenizeFn, processFn);

    // ── Retrieve ────────────────────────────────────────────────────────────
    const lexicalNeeded = mode === 'keyword' || mode === 'hybrid';
    const semanticNeeded = mode === 'semantic' || mode === 'hybrid';

    const lexical = lexicalNeeded
      ? this.lexicalSearch_(remainder || query.trim(), container, { ...opts, k })
      : { hits: [], detail: new Map() };

    const restrict = opts.restrictToLexical ?? this.restrictToLexical_;
    const allow = mode === 'hybrid' && restrict
      ? new Set(lexical.hits.map(hit => hit.id))
      : null;

    const semantic = semanticNeeded
      ? await this.semanticSearch_(query, container, { ...opts, k, allow })
      : [];

    // ── Fuse ────────────────────────────────────────────────────────────────
    let ranked;
    if (mode === 'hybrid') {
      ranked = fuse(lexical.hits, semantic, {
        method: opts.fusion || this.fusion_,
        alpha: opts.alpha ?? this.alpha_,
        k: opts.rrfK,
        weights: opts.weights
      });
    } else if (mode === 'keyword') {
      ranked = lexical.hits.map(hit => ({
        id: hit.id, score: hit.score,
        lexicalScore: hit.score, semanticScore: null, matchedBy: 'lexical'
      }));
    } else {
      ranked = semantic.map(hit => ({
        id: hit.id, score: hit.score,
        lexicalScore: null, semanticScore: hit.score, matchedBy: 'semantic'
      }));
    }

    // ── Shape, gate and filter ──────────────────────────────────────────────
    const results = [];
    for (const entry of ranked) {
      const doc = container.documents.get(entry.id);
      if (!doc) continue;

      const detail = lexical.detail.get(entry.id);
      const terms = detail ? Array.from(detail.terms) : [];

      // Exact-phrase gate. A phrase is an instruction, not a hint — it applies
      // whichever retriever surfaced the document. Without lexical detail for
      // this document (a semantic-only hit) the token pre-check cannot run, so
      // the text check alone decides.
      if (phraseMatchers.length
        && !this.matchesAllPhrases_(doc, phraseMatchers, detail?.terms, !!detail)) {
        continue;
      }

      const match = {};
      if (detail) for (const [token, fields] of detail.match) match[token] = Array.from(fields);

      const result = {
        ...(doc.storedFields || {}),
        id: entry.id,
        key: entry.id,
        score: entry.score,
        lexicalScore: entry.lexicalScore,
        semanticScore: entry.semanticScore,
        matchedBy: entry.matchedBy,
        match,
        terms,
        obj: doc.sourceDoc || doc.storedFields || {}
      };
      if (filterFn && !filterFn(result)) continue;
      results.push(result);
    }

    const sliced = maxResults ? results.slice(0, maxResults) : results;

    if (this.snippet_.enabled) {
      for (const result of sliced) {
        const doc = container.documents.get(result.id);
        if (!doc?.text) continue;
        // A semantic-only hit has no matched terms to centre on, so fall back
        // to the head of the document rather than returning nothing.
        result.snippet = result.terms.length || phraseMatchers.length
          ? this.buildSnippet_(doc.text, result.terms, phraseMatchers)
          : this.generateExcerpt_(doc.text, this.snippet_.maxChars);
      }
    }

    analytics.trackSearch(query, sliced.length, name);
    this.eventEmitter_?.emit('search:search', {
      searchTerm: query, searchContainer: name, mode, results: sliced.length
    });
    return sliced;
  }

  /**
   * Convenience wrapper for a pure vector search.
   *
   * @param {string} query
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<Array<Object>>}
   */
  async semanticSearch(query, containerOrOptions = this.defaultIndex_) {
    const opts = this.mergeSearchOptions_(containerOrOptions);
    return this.search(query, { ...opts, mode: 'semantic' });
  }

  /**
   * Convenience wrapper for a fused keyword + vector search.
   *
   * @param {string} query
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<Array<Object>>}
   */
  async hybridSearch(query, containerOrOptions = this.defaultIndex_) {
    const opts = this.mergeSearchOptions_(containerOrOptions);
    return this.search(query, { ...opts, mode: 'hybrid' });
  }

  /**
   * Documents most similar to one already indexed — "more like this".
   *
   * Falls out of the vector store for free: the document's own vector is the
   * query.
   *
   * @param {string} id Document id.
   * @param {string|Object} [containerOrOptions]
   * @return {Promise<Array<Object>>} Similar documents, excluding the subject.
   * @throws {Error} If the document has no vector yet.
   *
   * @example
   * const related = await search.similar('doc-1', { k: 5 });
   */
  async similar(id, containerOrOptions = this.defaultIndex_) {
    const opts = this.mergeSearchOptions_(containerOrOptions);
    const { container } = this.getContainer_(opts.containerName);

    // An unchunked document is stored under its own id; a chunked one has no
    // vector of its own, so seed from its first chunk.
    const seed = container.vectors.get(id)
      || container.vectors.get(`${id}${CHUNK_DELIMITER}0`);

    if (!seed) {
      throw new Error(
        `similar: no vector for "${id}" — it may be unknown, or still queued for embedding`
      );
    }

    const k = Number.isInteger(opts.k) && opts.k > 0 ? opts.k : 10;
    const hits = container.vectors.knn(seed, {
      k: k + 1,
      minScore: opts.minScore ?? this.minScore_
    });

    const results = [];
    for (const hit of hits) {
      if (hit.id === id) continue;
      const doc = container.documents.get(hit.id);
      if (!doc) continue;
      results.push({
        ...(doc.storedFields || {}),
        id: hit.id,
        key: hit.id,
        score: hit.score,
        lexicalScore: null,
        semanticScore: hit.score,
        matchedBy: 'semantic',
        match: {},
        terms: [],
        obj: doc.sourceDoc || doc.storedFields || {}
      });
      if (results.length >= k) break;
    }
    return results;
  }

  /**
   * BM25 retrieval over the duplicated lexical index.
   *
   * @param {string} query
   * @param {Object} container
   * @param {Object} opts
   * @return {{hits: Array<{id: string, score: number}>,
   *   detail: Map<string, {match: Map, terms: Set}>}}
   * @private
   */
  lexicalSearch_(query, container, opts) {
    const searchFields = Array.isArray(opts.fields) && opts.fields.length > 0
      ? opts.fields
      : this.fields_;
    const boost = opts.boost || {};
    const combineAnd = String(opts.combineWith || 'OR').toUpperCase() === 'AND';
    const tokenizeFn = typeof opts.tokenize === 'function' ? opts.tokenize : this.tokenizeFn_;
    const processFn = typeof opts.processTerm === 'function' ? opts.processTerm : this.processTermFn_;

    const queryTokens = [];
    for (const raw of tokenizeFn(query)) {
      const processed = processFn(raw);
      if (processed && !queryTokens.includes(processed)) queryTokens.push(processed);
    }
    if (queryTokens.length === 0) return { hits: [], detail: new Map() };

    const scores = new Map();
    const detail = new Map();
    const N = container.documents.size;

    for (const token of queryTokens) {
      const byField = container.tokens.get(token);
      if (!byField) continue;
      const idf = this.computeIDF_(token, container, N);

      for (const field of searchFields) {
        const docMap = byField.get(field);
        if (!docMap) continue;
        const fieldBoost = boost[field] != null ? boost[field] : 1;
        const fieldStats = container.fieldStats.get(field);
        const avgFieldLen = fieldStats && fieldStats.docCount > 0
          ? fieldStats.totalLength / fieldStats.docCount
          : 0;

        for (const [docId, tf] of docMap) {
          const doc = container.documents.get(docId);
          if (!doc) continue;
          const fieldLen = doc.fieldLengths.get(field) || 0;
          const contribution = this.bm25Score_(tf, idf, fieldLen, avgFieldLen) * fieldBoost;
          scores.set(docId, (scores.get(docId) || 0) + contribution);

          let entry = detail.get(docId);
          if (!entry) { entry = { match: new Map(), terms: new Set() }; detail.set(docId, entry); }
          let fields = entry.match.get(token);
          if (!fields) { fields = new Set(); entry.match.set(token, fields); }
          fields.add(field);
          entry.terms.add(token);
        }
      }
    }

    if (combineAnd) {
      for (const [docId, entry] of detail) {
        if (entry.terms.size < queryTokens.length) scores.delete(docId);
      }
    }

    const hits = Array.from(scores.entries()).map(([id, score]) => ({ id, score }));
    hits.sort((a, b) => b.score - a.score);
    const k = Number.isInteger(opts.k) && opts.k > 0 ? opts.k : this.k_;
    return { hits: hits.slice(0, k), detail };
  }

  /**
   * Dense retrieval: embed the query and take the nearest neighbours.
   *
   * @param {string} query
   * @param {Object} container
   * @param {Object} opts
   * @return {Promise<Array<{id: string, score: number}>>}
   * @private
   */
  async semanticSearch_(query, container, opts) {
    if (container.vectors.size === 0) return [];

    const queryVector = await this.embedder.embed(query);
    if (!queryVector) {
      this.logger?.warn(`[${this.constructor.name}] Could not embed query; semantic branch skipped`);
      return [];
    }

    return container.vectors.knn(queryVector, {
      k: Number.isInteger(opts.k) && opts.k > 0 ? opts.k : this.k_,
      minScore: opts.minScore ?? this.minScore_,
      allow: opts.allow || null
    }).map(hit => ({ id: hit.id, score: hit.score, chunkId: hit.chunkId }));
  }

  /**
   * Merge per-call options over the instance defaults.
   *
   * @param {string|Object} containerOrOptions
   * @return {Object}
   * @private
   */
  mergeSearchOptions_(containerOrOptions) {
    const base = typeof containerOrOptions === 'string'
      ? { containerName: this.normalizeIndexName_(containerOrOptions) }
      : { containerName: this.defaultIndex_, ...(containerOrOptions || {}) };
    return { ...this.searchOptions_, ...base };
  }

  // ─── Phrase handling ────────────────────────────────────────────

  /**
   * Expose the query parser so consumers see the same phrases the engine did.
   *
   * @param {string} query
   * @return {{phrases: Array<string>, remainder: string}}
   */
  parseQuery(query) {
    return parseQuotedPhrases(query);
  }

  /**
   * Compile quoted phrases into matchers.
   *
   * @param {Array<string>} phrases
   * @param {Function} tokenizeFn
   * @param {Function} processFn
   * @return {Array<Object>}
   * @private
   */
  buildPhraseMatchers_(phrases, tokenizeFn, processFn) {
    const matchers = [];
    for (const phrase of phrases || []) {
      const needle = normalizeForPhrase(phrase);
      if (!needle) continue;
      const tokens = [];
      for (const t of tokenizeFn(phrase)) {
        const processed = processFn(t);
        if (processed && !tokens.includes(processed)) tokens.push(processed);
      }
      matchers.push({ phrase, needle, words: needle.trim().split(' '), tokens });
    }
    return matchers;
  }

  /**
   * True when a document satisfies every quoted phrase.
   *
   * @param {Object} doc
   * @param {Array<Object>} matchers
   * @param {Set<string>|undefined} matchedTokenSet Query tokens this document
   *   matched lexically.
   * @param {boolean} useTokenGate Apply the cheap token pre-check. False for a
   *   semantic-only hit, which has no lexical detail — the text check decides.
   * @return {boolean}
   * @private
   */
  matchesAllPhrases_(doc, matchers, matchedTokenSet, useTokenGate) {
    if (useTokenGate) {
      for (const m of matchers) {
        for (const token of m.tokens) {
          if (!matchedTokenSet || !matchedTokenSet.has(token)) return false;
        }
      }
    }
    const haystack = this.phraseHaystack_(doc);
    if (!haystack) return !!useTokenGate;
    for (const m of matchers) {
      if (haystack.indexOf(m.needle) === -1) return false;
    }
    return true;
  }

  /**
   * Normalized document text for phrase matching. This provider always retains
   * raw text, so the reconstruction fallbacks are belt-and-braces.
   *
   * @param {Object} doc
   * @return {string}
   * @private
   */
  phraseHaystack_(doc) {
    if (doc.text) return normalizeForPhrase(doc.text);
    const parts = [];
    const source = doc.sourceDoc || doc.storedFields;
    if (source && typeof source === 'object') {
      for (const field of this.fields_) {
        const value = this.extractFieldValue_(source, field);
        if (value) parts.push(value);
      }
    }
    if (doc.excerpt) parts.push(String(doc.excerpt));
    return parts.length ? normalizeForPhrase(parts.join('\n')) : '';
  }

  // ─── BM25 ───────────────────────────────────────────────────────

  /**
   * Document frequency of a token across all fields.
   *
   * @param {string} token
   * @param {Object} container
   * @return {number}
   * @private
   */
  computeDF_(token, container) {
    const byField = container.tokens.get(token);
    if (!byField) return 0;
    const docs = new Set();
    for (const docMap of byField.values()) {
      for (const docId of docMap.keys()) docs.add(docId);
    }
    return docs.size;
  }

  /**
   * BM25 IDF, floored so common terms contribute slightly rather than negatively.
   *
   * @param {string} token
   * @param {Object} container
   * @param {number} N
   * @return {number}
   * @private
   */
  computeIDF_(token, container, N) {
    if (N <= 0) return 0;
    const df = this.computeDF_(token, container);
    if (df === 0) return 0;
    return Math.max(Math.log(1 + (N - df + 0.5) / (df + 0.5)), 1e-6);
  }

  /**
   * BM25 score for one (token, field, document) triple.
   *
   * @param {number} tf
   * @param {number} idf
   * @param {number} fieldLen
   * @param {number} avgFieldLen
   * @return {number}
   * @private
   */
  bm25Score_(tf, idf, fieldLen, avgFieldLen) {
    if (tf <= 0 || idf <= 0) return 0;
    const { k1, b } = this.bm25_;
    const norm = avgFieldLen > 0 ? (1 - b + b * (fieldLen / avgFieldLen)) : 1;
    return idf * (tf * (k1 + 1)) / (tf + k1 * norm);
  }

  // ─── Suggestions ────────────────────────────────────────────────

  /**
   * Prefix suggestions over indexed document titles and tokens.
   *
   * Suggestions stay lexical by design: type-ahead is a prefix problem, and
   * embedding every keystroke would be slower and worse.
   *
   * @param {string} query
   * @param {Object} [options]
   * @param {number} [options.maxSuggestions=10]
   * @param {string} [options.containerName]
   * @return {Array<Object|string>}
   */
  suggest(query, options = {}) {
    if (!query || query.length < 2) return [];

    const maxSuggestions = options.maxSuggestions || 10;
    const { container } = this.getContainer_(options.containerName);
    const queryLower = query.toLowerCase();

    const documentSuggestions = [];
    for (const docInfo of container.documents.values()) {
      const stored = docInfo.storedFields || {};
      const docName = stored.name || stored.title
        || (docInfo.sourceDoc && (docInfo.sourceDoc.name || docInfo.sourceDoc.title))
        || '';
      if (!docName) continue;
      const nameLower = docName.toLowerCase();
      if (nameLower.includes(queryLower)) {
        documentSuggestions.push({
          title: docName,
          type: 'document',
          relevance: nameLower.startsWith(queryLower) ? 2 : 1
        });
      }
      if (documentSuggestions.length >= maxSuggestions) break;
    }

    const tokenSuggestions = [];
    if (documentSuggestions.length < maxSuggestions) {
      for (const token of container.tokens.keys()) {
        if (token.startsWith(queryLower) && token !== queryLower) {
          tokenSuggestions.push(token);
          if (tokenSuggestions.length >= (maxSuggestions - documentSuggestions.length)) break;
        }
      }
    }

    documentSuggestions.sort((a, b) => b.relevance - a.relevance);
    return [...documentSuggestions, ...tokenSuggestions].slice(0, maxSuggestions);
  }

  /**
   * Ranked compositional suggestions: prefix-expand the last query token and
   * score each completion by how many documents it reaches.
   *
   * @param {string} query
   * @param {Object} [options]
   * @param {number} [options.maxSuggestions=10]
   * @param {string} [options.containerName]
   * @return {Promise<Array<{suggestion: string, terms: Array<string>, score: number}>>}
   */
  async autoSuggest(query, options = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') return [];

    const { container } = this.getContainer_(options.containerName);
    const maxSuggestions = Number.isInteger(options.maxSuggestions) && options.maxSuggestions > 0
      ? options.maxSuggestions
      : 10;

    const words = query.trim().toLowerCase().split(/\s+/);
    const prefix = words[words.length - 1];
    const head = words.slice(0, -1);

    const completions = [];
    for (const token of container.tokens.keys()) {
      if (!token.startsWith(prefix)) continue;
      completions.push({ token, docs: this.computeDF_(token, container) });
      if (completions.length >= 500) break; // cap the scan on a huge vocabulary
    }

    completions.sort((a, b) => b.docs - a.docs || a.token.localeCompare(b.token));

    return completions.slice(0, maxSuggestions).map(({ token, docs }) => {
      const terms = [...head, token];
      return { suggestion: terms.join(' '), terms, score: docs };
    });
  }

  // ─── Stats & index management ───────────────────────────────────

  /**
   * Index statistics, including vector coverage and queue depth.
   *
   * @param {string} [containerName] One container, or all when omitted.
   * @return {Object}
   */
  getStats(containerName = null) {
    const describe = this.embedder.describe();

    if (containerName) {
      const { name, container } = this.getContainer_(containerName);
      const vectors = container.vectors.stats();
      return {
        searchContainer: name,
        totalDocuments: container.documents.size,
        indexedDocuments: Array.from(container.documents.values()).filter(d => d.isIndexed).length,
        totalTokens: container.tokens.size,
        vectorCount: vectors.size,
        embeddedDocuments: vectors.parents,
        pendingEmbeddings: this.pendingCount_(name),
        embeddingBackend: describe.backend,
        embeddingModel: describe.model,
        dimensions: this.dimensions,
        lastIndexTime: this.lastIndexTime,
        lastEmbedError: this.lastEmbedError
      };
    }

    let totalDocs = 0, totalIndexedDocs = 0, totalTokens = 0, vectorCount = 0, embeddedDocs = 0;
    for (const container of this.containers.values()) {
      totalDocs += container.documents.size;
      totalIndexedDocs += Array.from(container.documents.values()).filter(d => d.isIndexed).length;
      totalTokens += container.tokens.size;
      const vectors = container.vectors.stats();
      vectorCount += vectors.size;
      embeddedDocs += vectors.parents;
    }

    return {
      totalContainers: this.containers.size,
      totalDocuments: totalDocs,
      indexedDocuments: totalIndexedDocs,
      totalTokens,
      vectorCount,
      embeddedDocuments: embeddedDocs,
      pendingEmbeddings: this.pendingCount_(),
      embeddingBackend: describe.backend,
      embeddingModel: describe.model,
      dimensions: this.dimensions,
      lastIndexTime: this.lastIndexTime,
      lastEmbedError: this.lastEmbedError
    };
  }

  /**
   * Semantic-subsystem status, for the dashboard and status endpoint.
   *
   * @return {Object}
   */
  semanticStatus() {
    return {
      enabled: true,
      provider: PROVIDER_TAG,
      ...this.embedder.describe(),
      defaultMode: this.mode_,
      fusion: this.fusion_,
      alpha: this.alpha_,
      k: this.k_,
      minScore: this.minScore_,
      chunk: { ...this.chunk_ },
      autoEmbed: this.autoEmbed,
      pendingEmbeddings: this.pendingCount_(),
      maxVectorDocuments: this.maxVectorDocuments,
      lastEmbedError: this.lastEmbedError,
      embedderStats: { ...this.embedder.stats }
    };
  }

  /**
   * Empty a container without deleting it.
   *
   * @param {string} [containerName]
   * @return {boolean}
   */
  clearIndex(containerName = this.defaultIndex_) {
    const { name, container } = this.getContainer_(containerName);
    const previousSize = container.documents.size;
    container.documents.clear();
    container.tokens.clear();
    container.fieldStats.clear();
    container.vectors.clear();
    this.pending_.get(name)?.clear();

    this.eventEmitter_?.emit('search:index:cleared', {
      searchContainer: name, previousSize
    });
    return true;
  }

  /**
   * Delete a container entirely. The default index cannot be deleted.
   *
   * @param {string} [containerName]
   * @return {boolean}
   * @throws {Error} When asked to delete the default index.
   */
  deleteIndex(containerName = this.defaultIndex_) {
    const resolved = this.normalizeIndexName_(containerName);
    if (resolved === this.defaultIndex_) {
      throw new Error('Cannot delete the default index');
    }
    if (!this.containers.has(resolved)) return false;

    const deleted = this.containers.delete(resolved);
    this.pending_.delete(resolved);

    if (deleted) {
      this.eventEmitter_?.emit('search:index:deleted', {
        searchContainer: resolved, remainingContainers: this.containers.size
      });
    }
    return deleted;
  }

  /**
   * @return {Array<string>} Container names.
   */
  listIndexes() {
    return Array.from(this.containers.keys());
  }

  /**
   * @param {string} [containerName]
   * @return {Object|null}
   */
  getIndexStats(containerName = this.defaultIndex_) {
    const resolved = this.normalizeIndexName_(containerName);
    if (!this.containers.has(resolved)) return null;
    const container = this.containers.get(resolved);
    return {
      searchContainer: resolved,
      size: container.documents.size,
      keys: Array.from(container.documents.keys()),
      tokenCount: container.tokens.size,
      vectorCount: container.vectors.size,
      embeddedDocuments: container.vectors.parentCount
    };
  }

  // ─── Disk persistence ───────────────────────────────────────────

  /**
   * @private
   */
  async _ensureIndexDir() {
    if (!this.indexDir) return;
    try {
      await fs.mkdir(this.indexDir, { recursive: true });
    } catch (error) {
      this.logger?.warn(
        `[${this.constructor.name}] Could not create index directory: ${error.message}`
      );
    }
  }

  /**
   * Persist one container: lexical index as JSON, vectors as a raw buffer.
   *
   * @param {string} containerName
   * @param {Object} container
   * @private
   */
  async _saveContainerToDisk(containerName, container) {
    if (!this.indexDir) return;
    await this._ensureIndexDir();

    try {
      const containerDir = path.join(this.indexDir, containerName);
      await fs.mkdir(containerDir, { recursive: true });

      const docsObj = {};
      for (const [docId, info] of container.documents) {
        docsObj[docId] = {
          storedFields: info.storedFields,
          sourceDoc: info.sourceDoc,
          fieldTokens: Object.fromEntries(
            Array.from(info.fieldTokens.entries()).map(([f, set]) => [f, Array.from(set)])
          ),
          fieldLengths: Object.fromEntries(info.fieldLengths),
          text: info.text,
          excerpt: info.excerpt,
          isIndexed: info.isIndexed
        };
      }
      await fs.writeFile(
        path.join(containerDir, 'documents.json'), JSON.stringify(docsObj), 'utf8'
      );

      const tokensObj = {};
      for (const [token, fieldMap] of container.tokens) {
        const byField = {};
        for (const [field, docMap] of fieldMap) byField[field] = Object.fromEntries(docMap);
        tokensObj[token] = byField;
      }
      await fs.writeFile(
        path.join(containerDir, 'tokens.json'), JSON.stringify(tokensObj), 'utf8'
      );

      // Vectors go out as a raw Float32 buffer — JSON would roughly triple the
      // size and cost far more to parse back.
      const { buffer, meta } = container.vectors.serialize();
      await fs.writeFile(path.join(containerDir, 'vectors.bin'), buffer);
      await fs.writeFile(
        path.join(containerDir, 'vectors.meta.json'), JSON.stringify(meta), 'utf8'
      );

      await fs.writeFile(
        path.join(containerDir, 'meta.json'),
        JSON.stringify({
          version: DISK_FORMAT_VERSION,
          provider: PROVIDER_TAG,
          lastIndexTime: this.lastIndexTime,
          totalDocuments: container.documents.size,
          totalTokens: container.tokens.size,
          vectorCount: container.vectors.size,
          fields: this.fields_,
          fieldStats: Object.fromEntries(container.fieldStats),
          embedding: this.embedder.describe()
        }, null, 2),
        'utf8'
      );

      this.logger?.info(
        `[${this.constructor.name}] Saved ${containerName}: ${container.documents.size} docs, `
        + `${container.vectors.size} vectors`
      );
    } catch (error) {
      this.logger?.error(
        `[${this.constructor.name}] Failed to save ${containerName}: ${error.message}`
      );
    }
  }

  /**
   * Restore one container from disk.
   *
   * Returns false — meaning "rebuild" — whenever the data cannot be trusted:
   * a format change, another provider's directory, an expired TTL, or vectors
   * from a different embedding model. Documents still load in that last case;
   * only the vectors are dropped and re-queued, since the lexical index is
   * unaffected by a model change.
   *
   * @param {string} containerName
   * @param {Object} container
   * @return {Promise<boolean>}
   * @private
   */
  async _loadContainerFromDisk(containerName, container) {
    if (!this.indexDir) return false;

    try {
      const containerDir = path.join(this.indexDir, containerName);
      const meta = JSON.parse(await fs.readFile(path.join(containerDir, 'meta.json'), 'utf8'));

      if (meta.version !== DISK_FORMAT_VERSION) {
        this.logger?.info(
          `[${this.constructor.name}] ${containerName} disk format ${meta.version} != `
          + `${DISK_FORMAT_VERSION}, will rebuild`
        );
        return false;
      }
      // Guard against two providers pointed at one directory.
      if (meta.provider !== PROVIDER_TAG) {
        this.logger?.warn(
          `[${this.constructor.name}] ${containerName} was written by provider `
          + `"${meta.provider}", not "${PROVIDER_TAG}"; refusing to load`
        );
        return false;
      }
      if (!meta.lastIndexTime) return false;

      const age = Date.now() - new Date(meta.lastIndexTime).getTime();
      if (age > this.diskTTLHours * 60 * 60 * 1000) {
        this.logger?.info(
          `[${this.constructor.name}] ${containerName} is ${Math.round(age / 3600000)}h old, will rebuild`
        );
        return false;
      }

      const docsJson = JSON.parse(
        await fs.readFile(path.join(containerDir, 'documents.json'), 'utf8')
      );
      container.documents.clear();
      for (const [docId, info] of Object.entries(docsJson)) {
        container.documents.set(docId, {
          storedFields: info.storedFields,
          sourceDoc: info.sourceDoc,
          fieldTokens: new Map(
            Object.entries(info.fieldTokens || {}).map(([f, arr]) => [f, new Set(arr)])
          ),
          fieldLengths: new Map(Object.entries(info.fieldLengths || {})),
          text: info.text,
          excerpt: info.excerpt,
          isIndexed: info.isIndexed !== false
        });
      }

      const tokensJson = JSON.parse(
        await fs.readFile(path.join(containerDir, 'tokens.json'), 'utf8')
      );
      container.tokens.clear();
      for (const [token, byField] of Object.entries(tokensJson)) {
        const fieldMap = new Map();
        for (const [field, docMap] of Object.entries(byField)) {
          fieldMap.set(field, new Map(Object.entries(docMap).map(([d, tf]) => [d, Number(tf)])));
        }
        container.tokens.set(token, fieldMap);
      }

      container.fieldStats.clear();
      for (const [field, stats] of Object.entries(meta.fieldStats || {})) {
        container.fieldStats.set(field, stats);
      }

      await this._loadVectorsFromDisk(containerName, containerDir, container);

      for (let i = 0; i < container.documents.size; i++) analytics.trackAdd(containerName);
      this.lastIndexTime = meta.lastIndexTime ? new Date(meta.lastIndexTime) : null;

      this.logger?.info(
        `[${this.constructor.name}] Loaded ${containerName}: ${container.documents.size} docs, `
        + `${container.vectors.size} vectors`
      );
      return true;
    } catch (error) {
      this.logger?.debug(
        `[${this.constructor.name}] No valid ${containerName} on disk: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Restore the vector store, re-queueing everything when the stored vectors
   * came from a different model or width.
   *
   * @param {string} containerName
   * @param {string} containerDir
   * @param {Object} container
   * @private
   */
  async _loadVectorsFromDisk(containerName, containerDir, container) {
    let restored = null;
    try {
      const [buffer, vectorMeta] = await Promise.all([
        fs.readFile(path.join(containerDir, 'vectors.bin')),
        fs.readFile(path.join(containerDir, 'vectors.meta.json'), 'utf8').then(JSON.parse)
      ]);
      restored = VectorStore.deserialize({ buffer, meta: vectorMeta }, {
        dimensions: this.dimensions,
        model: this.embedder.model
      });
    } catch (error) {
      this.logger?.debug(
        `[${this.constructor.name}] No usable vectors for ${containerName}: ${error.message}`
      );
    }

    if (restored) {
      container.vectors = restored;
      return;
    }

    // Lexical data is still valid — only the vectors are incomparable. Keep the
    // documents and re-embed from their retained text.
    container.vectors = new VectorStore({
      dimensions: this.dimensions,
      model: this.embedder.model
    });
    let queued = 0;
    for (const [docId, doc] of container.documents) {
      if (!doc.text) continue;
      this.enqueueEmbed_(containerName, docId, doc.text);
      queued++;
    }
    if (queued > 0) {
      this.logger?.info(
        `[${this.constructor.name}] Re-queued ${queued} document(s) in ${containerName} for embedding`
      );
    }
  }

  /**
   * Persist one container, or all of them.
   *
   * @param {string} [containerName]
   * @return {Promise<void>}
   */
  async saveToDisk(containerName = null) {
    if (!this.indexDir) return;
    if (containerName) {
      const container = this.containers.get(containerName);
      if (container) await this._saveContainerToDisk(containerName, container);
      return;
    }
    for (const [name, container] of this.containers) {
      await this._saveContainerToDisk(name, container);
    }
  }

  /**
   * Restore one container, or all of them.
   *
   * @param {string} [containerName]
   * @return {Promise<boolean>} True when anything was loaded.
   */
  async loadFromDisk(containerName = null) {
    if (!this.indexDir) return false;
    if (containerName) {
      this.createContainer_(containerName);
      return this._loadContainerFromDisk(containerName, this.containers.get(containerName));
    }
    let anyLoaded = false;
    for (const [name, container] of this.containers) {
      if (await this._loadContainerFromDisk(name, container)) anyLoaded = true;
    }
    return anyLoaded;
  }

  // ─── Context snippets ───────────────────────────────────────────

  /**
   * Normalize the `snippet` option.
   *
   * @param {boolean|Object|undefined} opt
   * @return {Object}
   * @private
   */
  normalizeSnippetOptions_(opt) {
    const defaults = {
      enabled: false, wordsBefore: 10, wordsAfter: 10,
      highlight: true, highlightTag: 'mark', maxChars: 400
    };
    if (!opt) return defaults;
    const o = opt === true ? {} : (typeof opt === 'object' ? opt : {});
    return {
      enabled: true,
      wordsBefore: o.wordsBefore ?? defaults.wordsBefore,
      wordsAfter: o.wordsAfter ?? defaults.wordsAfter,
      highlight: o.highlight ?? defaults.highlight,
      highlightTag: o.highlightTag ?? defaults.highlightTag,
      maxChars: o.maxChars ?? defaults.maxChars
    };
  }

  /**
   * Build a match-centred context snippet, anchored on an exact phrase when the
   * query had one, otherwise on the first matched term.
   *
   * @param {string} text
   * @param {Array<string>} terms
   * @param {Array<Object>} [phraseMatchers]
   * @return {string}
   * @private
   */
  buildSnippet_(text, terms, phraseMatchers) {
    const cfg = this.snippet_;
    if (!text) return '';
    const source = String(text);

    const wordRe = /[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;
    const words = [];
    let m;
    while ((m = wordRe.exec(source)) !== null) {
      words.push({ lower: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
      if (words.length >= 20000) break;
    }
    if (words.length === 0) return '';

    const termSet = Array.isArray(terms)
      ? terms.filter(Boolean).map(t => String(t).toLowerCase())
      : [];

    let anchor = -1;
    for (const matcher of (phraseMatchers || [])) {
      const pw = matcher.words;
      for (let i = 0; i + pw.length <= words.length; i++) {
        let hit = true;
        for (let j = 0; j < pw.length; j++) {
          if (words[i + j].lower !== pw[j]) { hit = false; break; }
        }
        if (hit) { anchor = i; break; }
      }
      if (anchor !== -1) break;
    }

    for (let i = 0; i < words.length && anchor === -1; i++) {
      const w = words[i].lower;
      for (const t of termSet) {
        if (w === t || (t.length >= 3 && w.startsWith(t))) { anchor = i; break; }
      }
    }
    if (anchor === -1) anchor = 0;

    let startIdx = anchor;
    for (let s = 0; s < cfg.wordsBefore && startIdx > 0; s++) {
      if (/[.!?]/.test(source.slice(words[startIdx - 1].end, words[startIdx].start))) break;
      startIdx--;
    }
    let endIdx = anchor;
    for (let s = 0; s < cfg.wordsAfter && endIdx < words.length - 1; s++) {
      if (/[.!?]/.test(source.slice(words[endIdx].end, words[endIdx + 1].start))) break;
      endIdx++;
    }

    let sliceEnd = words[endIdx].end;
    const tailM = /^\s*[.!?]/.exec(source.slice(sliceEnd, sliceEnd + 3));
    if (tailM) sliceEnd += tailM[0].length;

    let snippet = source.slice(words[startIdx].start, sliceEnd).replace(/\s+/g, ' ').trim();
    if (cfg.maxChars && snippet.length > cfg.maxChars) {
      snippet = snippet.slice(0, cfg.maxChars).replace(/\s+\S*$/, '').trim();
    }

    const startsMid = startIdx > 0;
    const endsMid = endIdx < words.length - 1 && !/[.!?]$/.test(snippet);

    if (cfg.highlight && termSet.length) snippet = this.highlightTerms_(snippet, termSet);

    return `${startsMid ? '… ' : ''}${snippet}${endsMid ? ' …' : ''}`;
  }

  /**
   * Wrap matched terms in the configured highlight tag.
   *
   * @param {string} snippet
   * @param {Array<string>} termSet
   * @return {string}
   * @private
   */
  highlightTerms_(snippet, termSet) {
    const tag = this.snippet_.highlightTag;
    const uniq = Array.from(new Set(termSet))
      .filter(t => t && t.length >= 2)
      .sort((a, b) => b.length - a.length)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!uniq.length) return snippet;
    let re;
    try {
      re = new RegExp('(?<![\\p{L}\\p{N}])(' + uniq.join('|') + ')([\\p{L}\\p{N}]*)', 'giu');
    } catch (_) {
      return snippet;
    }
    return snippet.replace(re, (_match, p1, p2) => `<${tag}>${p1}${p2}</${tag}>`);
  }

  // ─── Misc ───────────────────────────────────────────────────────

  /**
   * Strip light markup and clip to a readable excerpt.
   *
   * @param {string} content
   * @param {number} [maxLength=200]
   * @return {string}
   * @private
   */
  generateExcerpt_(content, maxLength = 200) {
    if (!content) return '';
    const cleaned = String(content)
      .replace(/#{1,6}\s/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n\s*\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength).replace(/\s+\w*$/, '') + '...';
  }

  /**
   * @return {Promise<Object>} Service settings for the Settings tab.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Apply settings from the Settings tab. Only the tuning knobs are writable —
   * changing the embedding model at runtime would invalidate every stored
   * vector, so that stays a construction-time decision.
   *
   * @param {Object} settings
   * @return {Promise<void>}
   */
  async saveSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (MODES.has(settings.mode)) this.mode_ = settings.mode;
    if (settings.fusion === 'rrf' || settings.fusion === 'weighted') this.fusion_ = settings.fusion;
    if (settings.alpha != null && !Number.isNaN(Number(settings.alpha))) {
      this.alpha_ = Number(settings.alpha);
    }
    if (Number.isInteger(Number(settings.k)) && Number(settings.k) > 0) {
      this.k_ = Number(settings.k);
    }
    if (settings.minScore != null && !Number.isNaN(Number(settings.minScore))) {
      this.minScore_ = Number(settings.minScore);
    }
    this.logger?.info(`[${this.constructor.name}] Settings updated`, {
      mode: this.mode_, fusion: this.fusion_, alpha: this.alpha_, k: this.k_
    });
  }

  /**
   * Cancel any scheduled background embedding. Call when tearing down a service
   * instance so nothing is left pending.
   *
   * @return {void}
   */
  close() {
    if (this.drainTimer_) {
      clearTimeout(this.drainTimer_);
      this.drainTimer_ = null;
    }
  }
}

module.exports = VectorSearchService;
module.exports.VectorSearchService = VectorSearchService;
module.exports.DISK_FORMAT_VERSION = DISK_FORMAT_VERSION;
