/**
 * @fileoverview Search Service Factory
 * Factory module for creating search service instances.
 * Provides full-text search, indexing, and query capabilities.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const SearchService = require('./providers/searching.js');
const VectorSearchService = require('./providers/vectorsearching.js');
const SearchingApi = require('./providers/searchingApi');
const SearchingSOLR = require('./providers/searchingSOLR.js');

const Routes = require('./routes');
const Views = require('./views');
const Scripts = require('./scripts');
const { applyIndexerCompat } = require('./indexerCompat');

/**
 * Creates a search service instance with indexing and query capabilities.
 * Automatically configures routes and views for the search service.
 *
 * Provider types:
 * - 'default' — the single local search engine: a field-aware inverted index
 *   with BM25 scoring, prefix/fuzzy matching, compositional autoSuggest, disk
 *   persistence, and bulk operations. MiniSearch-compatible: pass `fields`,
 *   `storeFields`, `boost`, `extractField`, `tokenize`, `processTerm`,
 *   `searchOptions`, etc. through `options`. Omitting `fields` falls back to a
 *   synthetic `_all` field that stringifies the whole document (backward
 *   compatible — just `add(key, obj)` and `search(term)`).
 *   Supports exact-phrase queries: `search('Oracle "MySQL Enterprise"')`.
 *   Aliases 'tokens', 'memory' and 'files' all map to this same engine.
 * - 'vector' — the semantic engine: documents are embedded into dense vectors
 *   at index time and queries are answered by cosine similarity, so a search
 *   for "reset my password" can retrieve "Credential recovery procedure". It is
 *   a standalone provider, not a mode of the default engine — the two share no
 *   code path, so the semantic side can evolve without risk to BM25. Supports
 *   `mode: 'semantic' | 'hybrid' | 'keyword'` per call (`hybrid` fuses its own
 *   BM25 index with the vector ranking via Reciprocal Rank Fusion), plus
 *   `similar(id)` for more-like-this. Embeddings come from a pluggable backend
 *   configured through `options.embedding`; the default `hash` backend is
 *   deterministic and offline, so it works with no API key. Writes do not block
 *   on the network — call `flushEmbeddings()` when you need determinism.
 *   Aliases 'vectorsearching' and 'semantic' map to this same engine.
 * - 'api' — HTTP client proxying to a remote searching service
 * - 'solr' — Apache SOLR provider over its HTTP REST API. Maps named indexes
 *   onto a single collection via a container field, stores the full source
 *   object for round-trip, and indexes a flattened text blob for full-text
 *   matching. Configure via `SOLR_URL`, `SOLR_COLLECTION`, and the
 *   `SOLR_*_FIELD` options (see provider for full signature).
 *
 * @param {string} type - The search service type ('default', 'vector', 'api',
 *   'solr'; 'tokens' / 'memory' / 'files' are aliases for the local 'default'
 *   engine, and 'vectorsearching' / 'semantic' are aliases for 'vector')
 * @param {Object} options - Configuration options for the search service
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {SearchService|VectorSearchService|SearchingApi|SearchingSOLR} Search
 *   service instance
 *
 * @example
 * // Local engine, no fields configured (synthetic _all field)
 * const search = createSearchService('default', {}, eventEmitter);
 * await search.add('user-1', { name: 'John Doe' });
 * await search.search('john');
 *
 * @example
 * // Local engine with field-aware indexing and boost
 * const search = createSearchService('default', {
 *   fields: ['title', 'text'],
 *   storeFields: ['title', 'category'],
 *   searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.2 }
 * }, eventEmitter);
 * await search.addAll(documents);
 * const results = await search.search('moto', { fields: ['title'] });
 * const suggestions = await search.autoSuggest('zen ar');
 *
 * @example
 * // Semantic engine, offline embeddings, hybrid by default
 * const search = createSearchService('vector', {
 *   fields: ['title', 'body'],
 *   mode: 'hybrid'
 * }, eventEmitter);
 * await search.addAll(documents);
 * await search.flushEmbeddings();
 * const results = await search.search('how do I reset my password');
 * const related = await search.similar(results[0].id);
 */
function createSearchService(type, options, eventEmitter) {
  const { dependencies = {}, ...providerOptions } = options;

  // Emit service instantiation event
  eventEmitter.emit('Search Service Instantiated', {});

  // Create search service instance
  let searching;

  switch (type) {
    case 'vectorsearching': // explicit file-name alias
    case 'semantic':        // intent alias
    case 'vector':
      searching = new VectorSearchService(providerOptions, eventEmitter, dependencies);
      break;
    case 'api':
      searching = new SearchingApi(providerOptions, eventEmitter, dependencies);
      break;
    case 'solr':
      searching = new SearchingSOLR(providerOptions, eventEmitter, dependencies);
      break;
    case 'tokens':      // legacy alias — searchingTokens.js was merged into searching.js
    case 'memory':      // registry default provider name
    case 'files':       // legacy alias — searchingFile.js was a duplicate of searching.js
    case 'default':
    default:
      searching = new SearchService(providerOptions, eventEmitter, dependencies);
      break;
  }

  // Inject dependencies for logging
  if (dependencies.logging) {
    searching.logger = dependencies.logging;
    searching.log = (level, message, meta = {}) => {
      if (typeof dependencies.logging[level] === 'function') {
        dependencies.logging[level](`[SEARCHING:${type.toUpperCase()}] ${message}`, meta);
      }
    };

    // Log searching service initialization
    searching.log('info', 'Searching service initialized', {
      provider: type,
      hasLogging: true
    });
  }

  // Store all dependencies for potential use
  searching.dependencies = dependencies;

  // Normalize the provider to the indexer-facing contract so a consumer can
  // swap providers by changing only `type`/`options`. Additive and a no-op for
  // providers that already implement the contract natively (the local engine).
  applyIndexerCompat(searching, providerOptions);

  // Initialize routes, views and scripts for the search service
  Routes(options, eventEmitter, searching);
  Views(options, eventEmitter, searching);
  Scripts(options, eventEmitter, searching);


  return searching;
}

module.exports = createSearchService;
