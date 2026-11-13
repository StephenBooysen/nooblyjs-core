/**
 * @fileoverview Knowledge base over filing, searching and AI (feature 05).
 *
 * `sync()` walks a filing source, chunks each Markdown or text file, and indexes
 * the chunks in a vector search container. A file is re-indexed only when its
 * content hash changes, and removed files lose their chunks. `retrieve()` runs
 * hybrid search. `ask()` answers from the retrieved chunks only and cites them by
 * number; an answer with no citation is flagged `low`.
 *
 * Limits: the sync state lives in memory, so after a restart the first sync
 * re-indexes everything. Access control by role tag is not applied yet.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { chunkMarkdown } = require('../modules/chunk');

const DEFAULT_EXTENSIONS = ['.md', '.markdown', '.txt'];
const ANSWER_SYSTEM = [
  'Answer the question using only the numbered sources.',
  'After each claim, cite the source it came from in square brackets, for example [1].',
  'If the sources do not contain the answer, say that they do not.'
].join(' ');

/**
 * @param {string} text
 * @return {string} SHA-256 hex digest
 */
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * Filing paths are relative to the filing root. A leading slash is accepted
 * and dropped, so `/docs` and `docs` name the same folder; the root is `.`.
 * @param {string} dir
 * @return {string} Relative folder path
 */
const relativeDir = (dir) => {
  const cleaned = String(dir || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return cleaned || '.';
};

class KnowledgeBase {
  /**
   * @param {Object} deps
   * @param {Object} deps.filing Filing service instance (list, read)
   * @param {Object} deps.searching Vector search instance (indexDocument, remove, hybridSearch, flushEmbeddings)
   * @param {Object} deps.aiservice AI service instance (complete)
   * @param {Object} [deps.logger] Logging service instance
   * @param {Object} [options]
   * @param {string} [options.container='knowledge'] Search container for the chunks
   * @param {string[]} [options.extensions] File extensions to index
   * @param {number} [options.maxChunkChars=1200]
   * @param {number} [options.overlapChars=150]
   * @param {number} [options.topK=5] Chunks to retrieve for a question
   * @param {EventEmitter} [eventEmitter]
   */
  constructor(deps, options = {}, eventEmitter = null) {
    if (!deps.filing || !deps.searching || !deps.aiservice) {
      throw new Error('knowledge needs filing, searching and aiservice dependencies');
    }
    if (typeof deps.searching.hybridSearch !== 'function') {
      throw new Error('knowledge needs a vector search instance: set the searching default provider to "vector" before creating it');
    }
    this.filing_ = deps.filing;
    this.searching_ = deps.searching;
    this.aiservice_ = deps.aiservice;
    this.logger_ = deps.logger || null;
    this.eventEmitter_ = eventEmitter;
    this.container_ = options.container || 'knowledge';
    this.extensions_ = (options.extensions || DEFAULT_EXTENSIONS).map((e) => e.toLowerCase());
    this.chunkOptions_ = { maxChars: options.maxChunkChars || 1200, overlapChars: options.overlapChars ?? 150 };
    this.topK_ = options.topK || 5;
    /** @private path -> { hash, chunkIds } */
    this.files_ = new Map();
  }

  /**
   * Lists indexable files under a folder, recursively. Hidden folders are skipped.
   * @private
   * @param {string} dir Folder
   * @param {string[]} out Collected file paths (mutated)
   * @return {Promise<string[]>}
   */
  async walk_(dir, out = []) {
    const entries = await this.filing_.list(dir);
    for (const entry of entries || []) {
      if (!entry || typeof entry.name !== 'string' || entry.name.startsWith('.')) continue;
      const full = path.posix.join(dir, entry.name);
      if (entry.isDirectory || entry.type === 'folder') {
        await this.walk_(full, out);
      } else if (this.extensions_.includes(path.posix.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * Removes the chunks of one file from the index.
   * @private
   * @param {string[]} chunkIds
   * @return {Promise<void>}
   */
  async dropChunks_(chunkIds) {
    for (const id of chunkIds) {
      await this.searching_.remove(id, this.container_);
    }
  }

  /**
   * Brings the index in line with the source: new and changed files are indexed,
   * unchanged files are left alone, and removed files lose their chunks.
   *
   * @param {Object} [options]
   * @param {string} [options.directory='/'] Folder of the filing source to sync
   * @return {Promise<{files: number, added: number, changed: number, unchanged: number, removed: number, chunks: number}>}
   */
  async sync({ directory = '/' } = {}) {
    const root = relativeDir(directory);
    const found = await this.walk_(root);
    const seen = new Set();
    const stats = { files: found.length, added: 0, changed: 0, unchanged: 0, removed: 0, chunks: 0 };

    for (const file of found) {
      seen.add(file);
      const content = String(await this.filing_.read(file, 'utf8'));
      const hash = hashOf(content);
      const prior = this.files_.get(file);
      if (prior && prior.hash === hash) {
        stats.unchanged += 1;
        continue;
      }
      if (prior) await this.dropChunks_(prior.chunkIds);

      const title = (content.match(/^#\s+(.+)$/m) || [])[1] || path.posix.basename(file);
      const chunks = chunkMarkdown(content, this.chunkOptions_);
      const chunkIds = [];
      for (let i = 0; i < chunks.length; i += 1) {
        const id = `${file}#${i}`;
        await this.searching_.indexDocument(id, chunks[i].text, {
          path: file,
          title,
          heading: chunks[i].heading,
          chunk: i,
          hash,
          text: chunks[i].text
        }, this.container_);
        chunkIds.push(id);
      }
      this.files_.set(file, { hash, chunkIds });
      stats.chunks += chunks.length;
      if (prior) stats.changed += 1;
      else stats.added += 1;
    }

    for (const [file, prior] of [...this.files_.entries()]) {
      const underRoot = root === '.' || file === root || file.startsWith(`${root}/`);
      if (!seen.has(file) && underRoot) {
        await this.dropChunks_(prior.chunkIds);
        this.files_.delete(file);
        stats.removed += 1;
      }
    }

    await this.searching_.flushEmbeddings(this.container_);
    this.eventEmitter_?.emit?.('knowledge:synced', { ...stats });
    this.logger_?.info?.('[Knowledge] sync finished', { ...stats });
    return stats;
  }

  /**
   * Finds the chunks most relevant to a question.
   *
   * @param {string} question
   * @param {Object} [options]
   * @param {number} [options.k] Number of chunks (default topK)
   * @return {Promise<Array<{id: string, path: string, title: string, heading: string, snippet: string, score: number}>>}
   */
  async retrieve(question, { k } = {}) {
    const limit = Math.min(Math.max(1, k || this.topK_), 20);
    const hits = await this.searching_.hybridSearch(question, { containerName: this.container_, limit });
    return (Array.isArray(hits) ? hits : []).slice(0, limit).map((h) => ({
      id: h.id || h.key,
      path: h.path || h.obj?.path || '',
      title: h.title || h.obj?.title || '',
      heading: h.heading || h.obj?.heading || '',
      snippet: h.text || h.obj?.text || '',
      score: h.score
    }));
  }

  /**
   * Answers a question from the indexed sources.
   *
   * @param {string} question
   * @param {Object} [options]
   * @param {number} [options.k] Chunks to give the model
   * @return {Promise<{text: string, citations: Array<Object>, confidence: 'cited'|'low'|'none', usage: ?Object}>}
   */
  async ask(question, { k } = {}) {
    const sources = await this.retrieve(question, { k });
    if (sources.length === 0) {
      return { text: 'The sources do not contain an answer to this question.', citations: [], confidence: 'none', usage: null };
    }
    const context = sources
      .map((s, i) => `[${i + 1}] ${s.title}${s.heading ? ` > ${s.heading}` : ''} (${s.path})\n${s.snippet}`)
      .join('\n\n');
    const reply = await this.aiservice_.complete({
      system: ANSWER_SYSTEM,
      messages: [{ role: 'user', content: `Sources:\n\n${context}\n\nQuestion: ${question}` }],
      maxTokens: 600
    });
    const text = String(reply?.text ?? '');
    const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
      .filter((n) => n >= 1 && n <= sources.length);
    const citations = cited.map((n) => {
      const s = sources[n - 1];
      return { n, path: s.path, title: s.title, heading: s.heading, snippet: s.snippet.slice(0, 300), score: s.score };
    });
    return {
      text,
      citations,
      confidence: citations.length > 0 ? 'cited' : 'low',
      usage: reply?.usage ?? null
    };
  }

  /**
   * Counts of what is indexed.
   * @return {{files: number, chunks: number, container: string}}
   */
  status() {
    let chunks = 0;
    for (const f of this.files_.values()) chunks += f.chunkIds.length;
    return { files: this.files_.size, chunks, container: this.container_ };
  }
}

module.exports = { KnowledgeBase, hashOf };
