/**
 * @fileoverview Knowledge base over filing, searching and AI (feature 05).
 *
 * `sync()` walks a filing source, chunks each Markdown, text or HTML file, and
 * indexes the chunks in a vector search container. A file is re-indexed only when
 * its content hash or access rule changes, and removed files lose their chunks.
 *
 * `retrieve()` runs hybrid search, then keeps only the chunks the caller may see.
 * Each file has an access rule (a list of roles; `*` means any signed-in caller).
 * `ask()` answers from the retrieved chunks only and cites them by number; an
 * answer with no citation is flagged `low`.
 *
 * Sync state is saved as a hidden JSON file in the filing source (`.knowledge-state.json`).
 * With `restore: true` the next start re-indexes the saved chunks without reading
 * the source files, and the next sync only re-indexes what changed.
 *
 * Limits: PDF sources are not read (they need a parser). Access rules are set by
 * the app; the knowledge base does not read them from the documents.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { chunkMarkdown } = require('../modules/chunk');

const DEFAULT_EXTENSIONS = ['.md', '.markdown', '.txt', '.html', '.htm'];
const HTML_EXTENSIONS = ['.html', '.htm'];
const DEFAULT_STATE_FILE = '.knowledge-state.json';
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

/**
 * Turns an HTML page into plain text: scripts, styles and tags are removed, and
 * the common entities are decoded. Not a full HTML parser; enough for docs pages.
 * @param {string} html
 * @return {{title: string, text: string}}
 */
function htmlToText(html) {
  const decode = (value) => value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (m, n) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<[^>]+>/g, ' ');
  const text = decode(body).split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title: title.replace(/\s+/g, ' ').trim(), text };
}

/**
 * Whether a caller may see a chunk. `*` on either side means everyone; a caller
 * holding `*` (an administrator) sees every chunk.
 * @param {string[]} docRoles Roles the document is open to
 * @param {string[]} callerRoles Roles the caller holds
 * @return {boolean}
 */
function mayRead(docRoles, callerRoles) {
  if (callerRoles.includes('*') || docRoles.includes('*')) return true;
  return docRoles.some((r) => callerRoles.includes(r));
}

const sameRoles = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

class KnowledgeBase {
  /**
   * @param {Object} deps
   * @param {Object} deps.filing Filing service instance (list, read, create, update)
   * @param {Object} deps.searching Vector search instance (indexDocument, remove, hybridSearch, flushEmbeddings)
   * @param {Object} deps.aiservice AI service instance (complete)
   * @param {Object} [deps.logger] Logging service instance
   * @param {Object} [options]
   * @param {string} [options.container='knowledge'] Search container for the chunks
   * @param {string[]} [options.extensions] File extensions to index
   * @param {number} [options.maxChunkChars=1200]
   * @param {number} [options.overlapChars=150]
   * @param {number} [options.topK=5] Chunks to retrieve for a question
   * @param {function(string): string[]} [options.access] Roles a file is open to; default ['*']
   * @param {boolean} [options.persist=true] Save sync state to the filing source after each sync
   * @param {boolean} [options.restore=false] Load saved state when created
   * @param {string} [options.stateFile='.knowledge-state.json'] State file, relative to the filing root
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
    this.access_ = options.access || (() => ['*']);
    this.persist_ = options.persist !== false;
    this.stateFile_ = options.stateFile || DEFAULT_STATE_FILE;
    /** @private path -> { hash, roles, chunkIds, chunks: [{id, text, meta}] } */
    this.files_ = new Map();
    this.ready_ = options.restore ? this.load() : Promise.resolve(false);
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
   * Indexes chunks and records them against a file.
   * @private
   * @return {Promise<string[]>} Chunk ids
   */
  async indexChunks_(file, chunks, meta) {
    const ids = [];
    for (const chunk of chunks) {
      await this.searching_.indexDocument(chunk.id, chunk.text, { ...chunk.meta, ...meta }, this.container_);
      ids.push(chunk.id);
    }
    return ids;
  }

  /**
   * Saves sync state to the filing source. Chunk text is kept so a restart can
   * re-index without reading the files.
   * @return {Promise<boolean>} True when saved
   */
  async save() {
    const state = { version: 1, savedAt: new Date().toISOString(), files: {} };
    for (const [file, entry] of this.files_) {
      state.files[file] = { hash: entry.hash, roles: entry.roles, chunks: entry.chunks };
    }
    const body = JSON.stringify(state);
    try {
      await this.filing_.update(this.stateFile_, body);
    } catch (_err) {
      await this.filing_.create(this.stateFile_, body);
    }
    return true;
  }

  /**
   * Restores sync state saved by `save()` and re-indexes its chunks. Returns false
   * when there is no saved state or it cannot be read; the next sync then starts fresh.
   * @return {Promise<boolean>}
   */
  async load() {
    let state;
    try {
      state = JSON.parse(String(await this.filing_.read(this.stateFile_, 'utf8')));
    } catch (_err) {
      return false;
    }
    if (!state || state.version !== 1 || typeof state.files !== 'object') return false;
    for (const [file, entry] of Object.entries(state.files)) {
      const chunks = Array.isArray(entry.chunks) ? entry.chunks : [];
      const chunkIds = await this.indexChunks_(file, chunks, { hash: entry.hash, roles: entry.roles });
      this.files_.set(file, { hash: entry.hash, roles: entry.roles, chunkIds, chunks });
    }
    await this.searching_.flushEmbeddings(this.container_);
    this.logger_?.info?.('[Knowledge] restored saved state', { files: this.files_.size });
    return true;
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
    await this.ready_;
    const root = relativeDir(directory);
    const found = await this.walk_(root);
    const seen = new Set();
    const stats = { files: found.length, added: 0, changed: 0, unchanged: 0, removed: 0, chunks: 0 };

    for (const file of found) {
      seen.add(file);
      const raw = String(await this.filing_.read(file, 'utf8'));
      const hash = hashOf(raw);
      const roles = [...(this.access_(file) || ['*'])].sort();
      const prior = this.files_.get(file);
      if (prior && prior.hash === hash && sameRoles(prior.roles, roles)) {
        stats.unchanged += 1;
        continue;
      }
      if (prior) await this.dropChunks_(prior.chunkIds);

      let content = raw;
      let title = (raw.match(/^#\s+(.+)$/m) || [])[1] || path.posix.basename(file);
      if (HTML_EXTENSIONS.includes(path.posix.extname(file).toLowerCase())) {
        const page = htmlToText(raw);
        content = page.text;
        title = page.title || title;
      }
      const pieces = chunkMarkdown(content, this.chunkOptions_);
      const chunks = pieces.map((piece, i) => ({
        id: `${file}#${i}`,
        text: piece.text,
        meta: { path: file, title, heading: piece.heading, chunk: i, text: piece.text }
      }));
      const chunkIds = await this.indexChunks_(file, chunks, { hash, roles });
      this.files_.set(file, { hash, roles, chunkIds, chunks });
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
    if (this.persist_) await this.save();
    this.eventEmitter_?.emit?.('knowledge:synced', { ...stats });
    this.logger_?.info?.('[Knowledge] sync finished', { ...stats });
    return stats;
  }

  /**
   * Finds the chunks most relevant to a question that the caller may read.
   *
   * @param {string} question
   * @param {Object} [options]
   * @param {number} [options.k] Number of chunks (default topK)
   * @param {string[]} [options.roles=[]] Roles the caller holds; `*` sees everything
   * @return {Promise<Array<{id: string, path: string, title: string, heading: string, snippet: string, score: number}>>}
   */
  async retrieve(question, { k, roles = [] } = {}) {
    await this.ready_;
    const limit = Math.min(Math.max(1, k || this.topK_), 20);
    // Over-fetch, then filter, so a restricted chunk does not push a readable one out.
    const fetchLimit = Math.min(Math.max(limit * 5, 20), 100);
    const hits = await this.searching_.hybridSearch(question, { containerName: this.container_, limit: fetchLimit });
    const callerRoles = Array.isArray(roles) ? roles : [];
    return (Array.isArray(hits) ? hits : [])
      .filter((h) => mayRead(this.docRolesOf_(h), callerRoles))
      .slice(0, limit)
      .map((h) => ({
        id: h.id || h.key,
        path: h.path || h.obj?.path || '',
        title: h.title || h.obj?.title || '',
        heading: h.heading || h.obj?.heading || '',
        snippet: h.text || h.obj?.text || '',
        score: h.score
      }));
  }

  /**
   * Roles a hit was indexed with. A hit without roles is treated as open to all.
   * @private
   * @param {Object} hit
   * @return {string[]}
   */
  docRolesOf_(hit) {
    const roles = hit.roles ?? hit.obj?.roles;
    return Array.isArray(roles) ? roles : ['*'];
  }

  /**
   * Answers a question from the indexed sources the caller may read.
   *
   * @param {string} question
   * @param {Object} [options]
   * @param {number} [options.k] Chunks to give the model
   * @param {string[]} [options.roles] Roles the caller holds
   * @return {Promise<{text: string, citations: Array<Object>, confidence: 'cited'|'low'|'none', usage: ?Object}>}
   */
  async ask(question, { k, roles } = {}) {
    const sources = await this.retrieve(question, { k, roles });
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

module.exports = { KnowledgeBase, hashOf, htmlToText, mayRead };
