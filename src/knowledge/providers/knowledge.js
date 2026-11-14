/**
 * @fileoverview Knowledge base over filing, searching and AI (feature 05).
 *
 * `sync()` walks a filing source, turns each Markdown, text, HTML or PDF file into
 * text, chunks it, and indexes the chunks in a vector search container. A file is
 * re-indexed only when its content hash or access rule changes, and removed files
 * lose their chunks. With `watch: true` a change through the filing service starts
 * a sync on its own, after a short pause so a burst of changes runs one sync.
 *
 * `retrieve()` runs hybrid search, then keeps only the chunks the caller may see.
 * Each file has an access rule (a list of roles; `*` means any signed-in caller).
 * `ask()` answers from the retrieved chunks only and cites them by number; an
 * answer with no citation is flagged `low`. `streamAnswer()` and `askStream()`
 * give the same answer as it is written, as events or server-sent events.
 *
 * `recordFeedback()` keeps good and bad ratings of answers; `evaluate()` scores
 * retrieval (recall@k, mean reciprocal rank) and, when asked, whether answers cite
 * the expected document.
 *
 * Sync state is saved as a hidden JSON file in the filing source (`.knowledge-state.json`),
 * feedback in `.knowledge-feedback.json`. With `restore: true` the next start
 * re-indexes the saved chunks without reading the source files, and the next sync
 * only re-indexes what changed.
 *
 * Limits: access rules are set by the app; the knowledge base does not read them
 * from the documents. PDF text comes from `pdf-parse` and has no headings, so a
 * PDF is chunked by paragraph.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { chunkMarkdown } = require('../modules/chunk');
const { evaluateRetrieval, evaluateAnswers, parseEvalCases } = require('../modules/evaluate');

const DEFAULT_EXTENSIONS = ['.md', '.markdown', '.txt', '.html', '.htm', '.pdf'];
const HTML_EXTENSIONS = ['.html', '.htm'];
const DEFAULT_STATE_FILE = '.knowledge-state.json';
const DEFAULT_FEEDBACK_FILE = '.knowledge-feedback.json';
const ANSWER_SYSTEM = [
  'Answer the question using only the numbered sources.',
  'After each claim, cite the source it came from in square brackets, for example [1].',
  'If the sources do not contain the answer, say that they do not.'
].join(' ');
const NO_ANSWER = 'The sources do not contain an answer to this question.';

/**
 * @param {string|Buffer} content
 * @return {string} SHA-256 hex digest
 */
const hashOf = (content) => crypto.createHash('sha256').update(content).digest('hex');

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
 * Extracts the text of a PDF with `pdf-parse`. Pages are separated by blank
 * lines, so the chunker can split between them.
 * @param {Buffer} buffer PDF bytes
 * @return {Promise<{title: string, text: string, pages: number}>}
 * @throws {Error} When the file is not a readable PDF
 */
async function pdfToText(buffer) {
  // Loaded on first use: most apps never index a PDF.
  const pdfParse = require('pdf-parse');
  // pdf.js 1.10 misreads a Node Buffer; a plain Uint8Array copy parses correctly.
  const data = await pdfParse(new Uint8Array(buffer), { max: 0 });
  const text = String(data.text || '')
    .split(/\n{2,}/)
    .map((block) => block.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return { title: String(data.info?.Title || '').trim(), text, pages: data.numpages || 0 };
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

/**
 * Writes one server-sent event.
 * @param {import('node:http').ServerResponse} res
 * @param {string} event Event name
 * @param {Object} data JSON payload
 * @return {void}
 */
function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

class KnowledgeBase {
  /**
   * @param {Object} deps
   * @param {Object} deps.filing Filing service instance (list, read, create, update)
   * @param {Object} deps.searching Vector search instance (indexDocument, remove, hybridSearch, flushEmbeddings)
   * @param {Object} deps.aiservice AI service instance (complete, or a legacy prompt; stream when it has one)
   * @param {Object} [deps.logger] Logging service instance
   * @param {Object} [options]
   * @param {string} [options.container='knowledge'] Search container for the chunks
   * @param {string[]} [options.extensions] File extensions to index (default Markdown, text, HTML and PDF)
   * @param {number} [options.maxChunkChars=1200]
   * @param {number} [options.overlapChars=150]
   * @param {number} [options.topK=5] Chunks to retrieve for a question
   * @param {function(string): string[]} [options.access] Roles a file is open to; default ['*']
   * @param {boolean} [options.persist=true] Save sync state to the filing source after each sync
   * @param {boolean} [options.restore=false] Load saved state and feedback when created
   * @param {string} [options.stateFile='.knowledge-state.json'] State file, relative to the filing root
   * @param {string} [options.feedbackFile='.knowledge-feedback.json'] Feedback file, relative to the filing root
   * @param {number} [options.maxFeedback=500] Ratings kept; the oldest go first
   * @param {boolean} [options.watch=false] Sync when the filing service reports a change
   * @param {string} [options.watchDirectory='/'] Folder that a change-triggered sync covers
   * @param {number} [options.watchDelayMs=2000] Pause after the last change before syncing
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
    this.feedbackFile_ = options.feedbackFile || DEFAULT_FEEDBACK_FILE;
    this.maxFeedback_ = Math.max(1, options.maxFeedback || 500);
    /** @private path -> { hash, roles, title, indexedAt, chunkIds, chunks: [{id, text, meta}] } */
    this.files_ = new Map();
    /** @private newest last */
    this.feedback_ = [];
    this.lastSync_ = null;
    this.syncing_ = null;
    this.skipped_ = new Map();
    this.watchTimer_ = null;
    this.watchListeners_ = [];
    this.ready_ = options.restore ? this.load() : Promise.resolve(false);
    if (options.watch) this.watch_(options.watchDirectory || '/', options.watchDelayMs ?? 2000);
  }

  /**
   * Starts a sync, after a pause, whenever the filing service creates, updates or
   * deletes a file. Changes to the knowledge base's own state files are ignored.
   * @private
   * @param {string} directory Folder to sync
   * @param {number} delayMs Pause after the last change
   * @return {void}
   */
  watch_(directory, delayMs) {
    if (!this.eventEmitter_?.on) return;
    const own = [this.stateFile_, this.feedbackFile_].map((f) => path.posix.basename(f));
    const onChange = (event) => {
      const changed = String(event?.filePath || event?.path || '');
      if (own.includes(path.basename(changed))) return;
      clearTimeout(this.watchTimer_);
      this.watchTimer_ = setTimeout(() => {
        this.watchTimer_ = null;
        this.sync({ directory }).catch((err) => {
          this.logger_?.warn?.('[Knowledge] change-triggered sync failed', { error: err.message });
        });
      }, delayMs);
      this.watchTimer_.unref?.();
    };
    for (const name of ['filing:create', 'filing:update', 'filing:delete']) {
      this.eventEmitter_.on(name, onChange);
      this.watchListeners_.push([name, onChange]);
    }
  }

  /**
   * Stops watching for filing changes. The registry calls this on reset and shutdown.
   * @return {void}
   */
  destroy() {
    clearTimeout(this.watchTimer_);
    this.watchTimer_ = null;
    for (const [name, fn] of this.watchListeners_) this.eventEmitter_?.off?.(name, fn);
    this.watchListeners_ = [];
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
   * Reads one file and turns it into text with a title.
   * @private
   * @param {string} file Path relative to the filing root
   * @return {Promise<{hash: string, title: string, content: string}>}
   * @throws {Error} When the file cannot be read or parsed
   */
  async readSource_(file) {
    const ext = path.posix.extname(file).toLowerCase();
    if (ext === '.pdf') {
      const raw = await this.filing_.read(file);
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const pdf = await pdfToText(buffer);
      return { hash: hashOf(buffer), title: pdf.title || path.posix.basename(file), content: pdf.text };
    }
    const raw = String(await this.filing_.read(file, 'utf8'));
    let content = raw;
    let title = (raw.match(/^#\s+(.+)$/m) || [])[1] || path.posix.basename(file);
    if (HTML_EXTENSIONS.includes(ext)) {
      const page = htmlToText(raw);
      content = page.text;
      title = page.title || title;
    }
    return { hash: hashOf(raw), title, content };
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
   * Writes a JSON file to the filing source, creating it when it does not exist.
   * @private
   * @param {string} file
   * @param {Object} value
   * @return {Promise<void>}
   */
  async writeJson_(file, value) {
    const body = JSON.stringify(value);
    try {
      await this.filing_.update(file, body);
    } catch (_err) {
      await this.filing_.create(file, body);
    }
  }

  /**
   * Saves sync state to the filing source. Chunk text is kept so a restart can
   * re-index without reading the files.
   * @return {Promise<boolean>} True when saved
   */
  async save() {
    const state = { version: 1, savedAt: new Date().toISOString(), lastSync: this.lastSync_, files: {} };
    for (const [file, entry] of this.files_) {
      state.files[file] = { hash: entry.hash, roles: entry.roles, title: entry.title, indexedAt: entry.indexedAt, chunks: entry.chunks };
    }
    await this.writeJson_(this.stateFile_, state);
    return true;
  }

  /**
   * Restores sync state saved by `save()` and re-indexes its chunks, then loads
   * saved feedback. Returns false when there is no saved state or it cannot be
   * read; the next sync then starts fresh.
   * @return {Promise<boolean>}
   */
  async load() {
    await this.loadFeedback_();
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
      this.files_.set(file, {
        hash: entry.hash,
        roles: entry.roles,
        title: entry.title || chunks[0]?.meta?.title || path.posix.basename(file),
        indexedAt: entry.indexedAt || state.savedAt || null,
        chunkIds,
        chunks
      });
    }
    this.lastSync_ = state.lastSync || null;
    await this.searching_.flushEmbeddings(this.container_);
    this.logger_?.info?.('[Knowledge] restored saved state', { files: this.files_.size });
    return true;
  }

  /**
   * Loads saved feedback. Missing or unreadable feedback leaves the list empty.
   * @private
   * @return {Promise<void>}
   */
  async loadFeedback_() {
    try {
      const saved = JSON.parse(String(await this.filing_.read(this.feedbackFile_, 'utf8')));
      if (Array.isArray(saved?.items)) this.feedback_ = saved.items.slice(-this.maxFeedback_);
    } catch (_err) {
      // No feedback saved yet.
    }
  }

  /**
   * Brings the index in line with the source: new and changed files are indexed,
   * unchanged files are left alone, and removed files lose their chunks. A file
   * that cannot be read or parsed is skipped and listed in `status().skipped`.
   * A sync that starts while another is running waits for it, then runs.
   *
   * @param {Object} [options]
   * @param {string} [options.directory='/'] Folder of the filing source to sync
   * @return {Promise<{files: number, added: number, changed: number, unchanged: number, removed: number, skipped: number, chunks: number}>}
   */
  async sync({ directory = '/' } = {}) {
    const previous = this.syncing_ || Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.syncOnce_(directory));
    this.syncing_ = run;
    try {
      return await run;
    } finally {
      if (this.syncing_ === run) this.syncing_ = null;
    }
  }

  /**
   * One sync pass; see `sync()`.
   * @private
   * @param {string} directory
   * @return {Promise<Object>} Stats
   */
  async syncOnce_(directory) {
    await this.ready_;
    const startedAt = Date.now();
    const root = relativeDir(directory);
    const found = await this.walk_(root);
    const seen = new Set();
    const stats = { files: found.length, added: 0, changed: 0, unchanged: 0, removed: 0, skipped: 0, chunks: 0 };

    for (const file of found) {
      seen.add(file);
      let source;
      try {
        source = await this.readSource_(file);
      } catch (err) {
        stats.skipped += 1;
        // The reason shown to callers is generic; the error itself goes to the log.
        this.skipped_.set(file, path.posix.extname(file).toLowerCase() === '.pdf' ? 'not a readable PDF' : 'could not be read');
        this.logger_?.warn?.('[Knowledge] skipped a file it could not read', { file, error: err.message });
        continue;
      }
      this.skipped_.delete(file);
      const roles = [...(this.access_(file) || ['*'])].sort();
      const prior = this.files_.get(file);
      if (prior && prior.hash === source.hash && sameRoles(prior.roles, roles)) {
        stats.unchanged += 1;
        continue;
      }
      if (prior) await this.dropChunks_(prior.chunkIds);

      const pieces = chunkMarkdown(source.content, this.chunkOptions_);
      const chunks = pieces.map((piece, i) => ({
        id: `${file}#${i}`,
        text: piece.text,
        meta: { path: file, title: source.title, heading: piece.heading, chunk: i, text: piece.text }
      }));
      const chunkIds = await this.indexChunks_(file, chunks, { hash: source.hash, roles });
      this.files_.set(file, { hash: source.hash, roles, title: source.title, indexedAt: new Date().toISOString(), chunkIds, chunks });
      stats.chunks += chunks.length;
      if (prior) stats.changed += 1;
      else stats.added += 1;
    }

    const underRoot = (file) => root === '.' || file === root || file.startsWith(`${root}/`);
    for (const [file, prior] of [...this.files_.entries()]) {
      if (!seen.has(file) && underRoot(file)) {
        await this.dropChunks_(prior.chunkIds);
        this.files_.delete(file);
        stats.removed += 1;
      }
    }
    for (const file of [...this.skipped_.keys()]) {
      if (!seen.has(file) && underRoot(file)) this.skipped_.delete(file);
    }

    await this.searching_.flushEmbeddings(this.container_);
    this.lastSync_ = { at: new Date().toISOString(), directory: root === '.' ? '/' : root, durationMs: Date.now() - startedAt, ...stats };
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
   * The model request for a question and its sources.
   * @private
   * @param {string} question
   * @param {Array<Object>} sources Retrieved chunks
   * @return {{system: string, messages: Array<Object>, maxTokens: number}}
   */
  answerRequest_(question, sources) {
    const context = sources
      .map((s, i) => `[${i + 1}] ${s.title}${s.heading ? ` > ${s.heading}` : ''} (${s.path})\n${s.snippet}`)
      .join('\n\n');
    return {
      system: ANSWER_SYSTEM,
      messages: [{ role: 'user', content: `Sources:\n\n${context}\n\nQuestion: ${question}` }],
      maxTokens: 600
    };
  }

  /**
   * Runs one model request. Uses the AI service's `complete()` (AI Service v2
   * providers); a legacy provider with only `prompt()` gets the system text and
   * the message joined into one prompt.
   * @private
   * @param {{system: string, messages: Array<Object>, maxTokens: number}} request
   * @return {Promise<{text: string, usage: ?Object}>}
   * @throws {Error} When the AI service has neither method
   */
  async complete_(request) {
    if (typeof this.aiservice_.complete === 'function') return this.aiservice_.complete(request);
    if (typeof this.aiservice_.prompt === 'function') {
      const text = [request.system, ...request.messages.map((m) => m.content)].join('\n\n');
      const reply = await this.aiservice_.prompt(text, { maxTokens: request.maxTokens });
      return { text: String(reply?.content ?? reply?.text ?? ''), usage: reply?.usage ?? null };
    }
    throw new Error('the AI service has neither complete() nor prompt()');
  }

  /**
   * Builds the answer object from the model's text: the citations it made, and
   * `cited` or `low` confidence.
   * @private
   * @param {string} text Model reply
   * @param {Array<Object>} sources Retrieved chunks, numbered from 1
   * @param {?Object} usage Token usage
   * @return {{text: string, citations: Array<Object>, confidence: string, usage: ?Object}}
   */
  buildAnswer_(text, sources, usage) {
    const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]
      .filter((n) => n >= 1 && n <= sources.length);
    const citations = cited.map((n) => {
      const s = sources[n - 1];
      return { n, path: s.path, title: s.title, heading: s.heading, snippet: s.snippet.slice(0, 300), score: s.score };
    });
    return { text, citations, confidence: citations.length > 0 ? 'cited' : 'low', usage: usage ?? null };
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
      return { text: NO_ANSWER, citations: [], confidence: 'none', usage: null };
    }
    const reply = await this.complete_(this.answerRequest_(question, sources));
    return this.buildAnswer_(String(reply?.text ?? ''), sources, reply?.usage);
  }

  /**
   * Answers a question as it is written. Yields `sources` (the numbered chunks the
   * model sees), then `text` deltas, then `done` with the same fields as `ask()`.
   * Uses the AI service's `stream()` when it has one; otherwise the whole reply
   * arrives as one `text` event.
   *
   * @param {string} question
   * @param {Object} [options]
   * @param {number} [options.k] Chunks to give the model
   * @param {string[]} [options.roles] Roles the caller holds
   * @return {AsyncGenerator<{type: 'sources'|'text'|'done', [key: string]: *}>}
   * @example
   * for await (const event of kb.streamAnswer('How do I rotate the secret?', { roles: ['*'] })) {
   *   if (event.type === 'text') process.stdout.write(event.text);
   * }
   */
  async *streamAnswer(question, { k, roles } = {}) {
    const sources = await this.retrieve(question, { k, roles });
    yield {
      type: 'sources',
      sources: sources.map((s, i) => ({ n: i + 1, path: s.path, title: s.title, heading: s.heading, score: s.score }))
    };
    if (sources.length === 0) {
      yield { type: 'text', text: NO_ANSWER };
      yield { type: 'done', text: NO_ANSWER, citations: [], confidence: 'none', usage: null };
      return;
    }
    const request = this.answerRequest_(question, sources);
    let text = '';
    let usage = null;
    if (typeof this.aiservice_.stream === 'function') {
      for await (const event of this.aiservice_.stream(request)) {
        if (event?.type === 'text_delta' && event.text) {
          text += event.text;
          yield { type: 'text', text: event.text };
        } else if (event?.type === 'message') {
          usage = event.message?.usage ?? usage;
        }
      }
    } else {
      const reply = await this.complete_(request);
      text = String(reply?.text ?? '');
      usage = reply?.usage ?? null;
      yield { type: 'text', text };
    }
    yield { type: 'done', ...this.buildAnswer_(text, sources, usage) };
  }

  /**
   * Streams an answer to an HTTP response as server-sent events: `sources`,
   * `text` (repeated), then `done`, or `error` if the model call fails.
   *
   * @param {import('node:http').ServerResponse} res Response to write to
   * @param {string} question
   * @param {Object} [options] Same as `streamAnswer()`
   * @return {Promise<?Object>} The `done` payload, or null after an error
   */
  async askStream(res, question, options = {}) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let done = null;
    try {
      for await (const event of this.streamAnswer(question, options)) {
        const { type, ...data } = event;
        if (type === 'done') done = data;
        sendEvent(res, type, data);
      }
    } catch (err) {
      this.logger_?.warn?.('[Knowledge] streamed answer failed', { error: err.message });
      sendEvent(res, 'error', { message: 'The answer could not be generated' });
    }
    res.end();
    return done;
  }

  /**
   * Records a rating of an answer. Kept in memory (the newest `maxFeedback`),
   * saved to the feedback file when `persist` is on, and emitted as
   * `knowledge:feedback`.
   *
   * @param {Object} entry
   * @param {string} entry.question The question asked
   * @param {'good'|'bad'} entry.rating
   * @param {string} [entry.answer] The answer given
   * @param {string[]} [entry.citations] Paths the answer cited
   * @param {string} [entry.comment]
   * @param {string} [entry.user] Who rated it
   * @return {Promise<Object>} The stored entry, with id and time
   * @throws {Error} When the rating is not good or bad, or the question is empty
   */
  async recordFeedback({ question, rating, answer = '', citations = [], comment = '', user = null }) {
    if (rating !== 'good' && rating !== 'bad') throw new Error('rating must be good or bad');
    if (!question || !String(question).trim()) throw new Error('question is required');
    const item = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      question: String(question).slice(0, 1000),
      rating,
      answer: String(answer).slice(0, 4000),
      citations: (Array.isArray(citations) ? citations : []).map(String).slice(0, 20),
      comment: String(comment).slice(0, 1000),
      user
    };
    this.feedback_.push(item);
    if (this.feedback_.length > this.maxFeedback_) this.feedback_.splice(0, this.feedback_.length - this.maxFeedback_);
    if (this.persist_) {
      try {
        await this.writeJson_(this.feedbackFile_, { version: 1, items: this.feedback_ });
      } catch (err) {
        this.logger_?.warn?.('[Knowledge] could not save feedback', { error: err.message });
      }
    }
    this.eventEmitter_?.emit?.('knowledge:feedback', { id: item.id, rating, citations: item.citations.length });
    return item;
  }

  /**
   * Lists feedback, newest first.
   * @param {Object} [options]
   * @param {'good'|'bad'} [options.rating] Only this rating
   * @param {number} [options.limit=50]
   * @return {{total: number, good: number, bad: number, items: Array<Object>}}
   */
  listFeedback({ rating, limit = 50 } = {}) {
    const good = this.feedback_.filter((f) => f.rating === 'good').length;
    const items = this.feedback_
      .filter((f) => !rating || f.rating === rating)
      .slice()
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, this.maxFeedback_)));
    return { total: this.feedback_.length, good, bad: this.feedback_.length - good, items };
  }

  /**
   * Evaluation cases built from answers rated good that cited a source: the
   * first cited path is the expected one.
   * @return {Array<{question: string, expectedPath: string}>}
   */
  feedbackCases() {
    const seen = new Set();
    const cases = [];
    for (const f of this.feedback_) {
      if (f.rating !== 'good' || !f.citations.length || seen.has(f.question)) continue;
      seen.add(f.question);
      cases.push({ question: f.question, expectedPath: f.citations[0] });
    }
    return cases;
  }

  /**
   * Scores the knowledge base against labelled questions: retrieval recall@k and
   * mean reciprocal rank and, with `answers: true`, how often the answer cites the
   * expected document (this calls the model once per case).
   *
   * @param {Array<{question: string, expectedPath: string, roles?: string[]}>|string} cases Cases, or YAML text listing them
   * @param {Object} [options]
   * @param {number} [options.k=5] Cut-off for recall
   * @param {boolean} [options.answers=false] Also ask each question and check the citations
   * @return {Promise<Object>} `{cases, recallAtK, meanReciprocalRank, results}` plus `citationAccuracy` and `answerResults` with answers
   * @throws {Error} When the YAML is not a list of cases
   */
  async evaluate(cases, { k = 5, answers = false } = {}) {
    const list = typeof cases === 'string' ? parseEvalCases(cases) : cases;
    const report = await evaluateRetrieval(this, list, { k });
    if (answers) Object.assign(report, await evaluateAnswers(this, list, { k }));
    this.eventEmitter_?.emit?.('knowledge:evaluated', { cases: report.cases, recallAtK: report.recallAtK, citationAccuracy: report.citationAccuracy ?? null });
    return report;
  }

  /**
   * Indexed files the caller may read, sorted by path.
   * @param {Object} [options]
   * @param {string[]} [options.roles=['*']] Roles the caller holds
   * @return {Array<{path: string, title: string, chunks: number, roles: string[], indexedAt: ?string}>}
   */
  sources({ roles = ['*'] } = {}) {
    const callerRoles = Array.isArray(roles) ? roles : [];
    return [...this.files_.entries()]
      .filter(([, f]) => mayRead(f.roles || ['*'], callerRoles))
      .map(([file, f]) => ({ path: file, title: f.title || path.posix.basename(file), chunks: f.chunkIds.length, roles: f.roles, indexedAt: f.indexedAt || null }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Counts of what is indexed, the last sync, files skipped and feedback.
   * @return {{files: number, chunks: number, container: string, syncing: boolean, lastSync: ?Object, skipped: Array<{path: string, error: string}>, feedback: {total: number, good: number, bad: number}}}
   */
  status() {
    let chunks = 0;
    for (const f of this.files_.values()) chunks += f.chunkIds.length;
    const good = this.feedback_.filter((f) => f.rating === 'good').length;
    return {
      files: this.files_.size,
      chunks,
      container: this.container_,
      syncing: Boolean(this.syncing_),
      lastSync: this.lastSync_,
      skipped: [...this.skipped_.entries()].map(([file, error]) => ({ path: file, error })),
      feedback: { total: this.feedback_.length, good, bad: this.feedback_.length - good }
    };
  }
}

module.exports = { KnowledgeBase, hashOf, htmlToText, pdfToText, mayRead };
