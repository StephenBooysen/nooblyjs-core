/**
 * @fileoverview Search engine API routes for Express.js application.
 * Provides RESTful endpoints for document indexing, search operations,
 * content removal, and service status monitoring with UUID-based keys.
 * Supports multiple named indexes for organizing different types of searchable content.
 *
 * @author NooblyJS Core Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const crypto = require('crypto');
const analytics = require('../modules/analytics');
const { sendSafeError } = require('../../shared/utils/safeError');
const { route } = require('../../shared/utils/routePattern');
const { capLimit, parseLimit, validate } = require('../../shared/utils/validation');

/**
 * Configures and registers search routes with the Express application.
 * Sets up endpoints for search index management and query operations.
 * All endpoints support an optional 'searchContainer' query parameter or field.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} search - The search provider instance with add/remove/search methods
 * @return {void}
 */
module.exports = (options, eventEmitter, search) => {
  if (options['express-app'] && search) {
    const app = options['express-app'];

    // Enforce authentication on every search API endpoint. Mounting the shared
    // API-key/session middleware on the /api prefix protects all routes below
    // regardless of how each handler is registered. Falls back to a
    // pass-through only when no auth is configured.
    const requireApiAuth = options.authMiddleware || ((req, res, next) => next());
    app.use('/services/searching/api', requireApiAuth);

    /**
     * POST /services/searching/api/add/
     * Adds content to the search index with an auto-generated UUID key.
     *
     * @param {express.Request} req - Express request object
     * @param {*} req.body - The content to add to the search index
     * @param {string} [req.body.searchContainer] - Optional index name (from body)
     * @param {string} [req.query.searchContainer] - Optional index name (from query)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/searching/api/add/', async (req, res) => {
      const key = crypto.randomUUID();
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { searchContainer: containerFromBody, ...value } = body;
      const searchContainer = containerFromBody || req.query.searchContainer;

      try {
        const added = await search.add(key, value, searchContainer);
        if (added) {
          res.status(200).json({ success: true });
        } else {
          res.status(400).json({ error: 'Key already exists' });
        }
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/searching/api/delete/:key
     * Removes content from the search index by key.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The UUID key of content to remove
     * @param {string} [req.query.searchContainer] - Optional index name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/searching/api/delete/:key', async (req, res) => {
      const key = req.params.key;
      const searchContainer = req.query.searchContainer;

      try {
        const removed = await search.remove(key, searchContainer);
        if (removed) {
          res.status(200).json({ success: true });
        } else {
          res.status(404).json({ error: 'Key not found' });
        }
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/search/:term
     * Performs a search query against the indexed content.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.term - The search term/query string
     * @param {string} [req.query.searchContainer] - Optional index name to search within
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/search/:term',
      validate({ params: { term: { type: 'string', required: true, maxLength: 1000 } } }),
      async (req, res) => {
      const term = req.params.term;
      const searchContainer = req.query.searchContainer;

      if (term) {
        try {
          const results = await search.search(term, searchContainer);
          res.status(200).json(results);
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      } else {
        res.status(400).json({ error: 'Missing query' });
      }
    });

    /**
     * GET /services/searching/api/status
     * Returns the operational status of the search service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/status', (req, res) => {
      eventEmitter.emit('api-searching-status', 'searching api running');
      res.status(200).json('searching api is running');
    });

    /**
     * GET /services/searching/api/indexes
     * Returns a list of all available indexes.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/indexes', (req, res) => {
      try {
        const indexNames = search.listIndexes();
        const indexes = indexNames.map((name) => {
          const stats = search.getIndexStats(name) || { size: 0 };
          return {
            name,
            count: stats.size || stats.indexedItems || 0
          };
        });

        res.status(200).json({ indexes });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/indexes/:searchContainer/stats
     * Returns statistics for a specific index.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.searchContainer - The name of the index
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/indexes/:searchContainer/stats', (req, res) => {
      try {
        const searchContainer = req.params.searchContainer;
        const stats = search.getIndexStats(searchContainer);

        if (stats) {
          res.status(200).json(stats);
        } else {
          res.status(404).json({ error: 'Index not found' });
        }
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/searching/api/indexes/:searchContainer
     * Deletes an entire index and all its contents.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.searchContainer - The name of the index to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/searching/api/indexes/:searchContainer', (req, res) => {
      try {
        const searchContainer = req.params.searchContainer;
        const result = search.deleteIndex(searchContainer);

        if (result) {
          res.status(200).json({ message: `Index '${searchContainer}' deleted successfully` });
        } else {
          res.status(404).json({ error: 'Index not found' });
        }
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/searching/api/indexes/:searchContainer/clear
     * Clears all documents from a specific index without deleting the index itself.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.searchContainer - The name of the index to clear
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/searching/api/indexes/:searchContainer/clear', (req, res) => {
      try {
        const searchContainer = req.params.searchContainer;
        const result = search.clearIndex(searchContainer);

        if (result) {
          res.status(200).json({ message: `Index '${searchContainer}' cleared successfully` });
        } else {
          res.status(404).json({ error: 'Index not found' });
        }
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/analytics
     * Returns aggregated analytics data including operation stats and search term statistics.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/analytics', async (req, res) => {
      try {
        const searchContainer = req.query.searchContainer;
        const limit = capLimit(parseInt(req.query.limit, 10));
        const [stats, analyticsData] = await Promise.all([
          search.getStats(searchContainer),
          Promise.resolve(
            analytics.getAllAnalytics({
              searchContainer,
              limit: Number.isNaN(limit) ? undefined : limit
            })
          )
        ]);

        res.status(200).json({
          ...analyticsData,
          stats
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/analytics/operations
     * Returns operation statistics only.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/analytics/operations', (req, res) => {
      try {
        const searchContainer = req.query.searchContainer;
        const stats = analytics.getOperationStats(searchContainer);
        res.status(200).json(stats);
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/analytics/terms
     * Returns search term analytics.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/analytics/terms', (req, res) => {
      try {
        const limit = parseLimit(req.query.limit, { defaultValue: 100 });
        const searchContainer = req.query.searchContainer;
        const terms = analytics.getSearchTermAnalytics(limit, searchContainer);
        res.status(200).json(terms);
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/searching/api/analytics
     * Clears all analytics data.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/searching/api/analytics', (req, res) => {
      try {
        analytics.clear();
        res.status(200).json({ message: 'Analytics data cleared successfully' });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/settings
     * Retrieves the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/settings', async (req, res) => {
      try {
        const settings = await search.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('api-searching-settings-error', err.message);
        res.status(500).json({ error: 'Failed to retrieve settings' });
      }
    });

     /**
     * POST /services/searching/api/settings
     * Saves the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/searching/api/settings', async (req, res) => {
      const message = req.body;
      if (message) {
        try {
          await search.saveSettings(message);
          res.status(200).json({ success: true });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      } else {
        res.status(400).json({ error: 'Missing settings' });
      }
    });

    /**
     * GET /services/searching/api/suggest/:term
     * Returns autocomplete suggestions (for token-based providers).
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.term - The search term to get suggestions for
     * @param {string} [req.query.searchContainer] - Optional container name
     * @param {string} [req.query.limit] - Max suggestions to return (default: 10)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/suggest/:term', (req, res) => {
      try {
        if (!search.suggest) {
          return res.status(501).json({
            error: 'Suggestions not supported by this search provider'
          });
        }

        const term = req.params.term;
        const searchContainer = req.query.searchContainer || 'default';
        const limit = parseLimit(req.query.limit, { defaultValue: 10, max: 100 });

        if (!term) {
          return res.status(400).json({ error: 'Missing search term' });
        }

        const suggestions = search.suggest(term, {
          maxSuggestions: limit,
          containerName: searchContainer
        });

        res.status(200).json(suggestions);
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/token-stats
     * Returns token-based statistics (for token-based providers).
     *
     * @param {express.Request} req - Express request object
     * @param {string} [req.query.searchContainer] - Optional container name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/token-stats', (req, res) => {
      try {
        const searchContainer = req.query.searchContainer;
        const stats = search.getStats(searchContainer);

        if (!stats.totalTokens) {
          return res.status(501).json({
            error: 'Token statistics not available for this search provider'
          });
        }

        res.status(200).json(stats);
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/autosuggest/:term
     * Returns compositional ranked suggestions (token-based providers).
     */
    app.get('/services/searching/api/autosuggest/:term', async (req, res) => {
      try {
        if (typeof search.autoSuggest !== 'function') {
          return res.status(501).json({
            error: 'autoSuggest not supported by this search provider'
          });
        }
        const term = req.params.term;
        if (!term) return res.status(400).json({ error: 'Missing search term' });

        const limit = parseLimit(req.query.limit, { defaultValue: 10, max: 100 });
        const containerName = req.query.searchContainer || 'default';
        const fuzzy = req.query.fuzzy != null ? Number(req.query.fuzzy) : undefined;

        const suggestions = await search.autoSuggest(term, {
          maxSuggestions: limit,
          containerName,
          fuzzy
        });
        res.status(200).json(suggestions);
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * POST /services/searching/api/search/:searchContainer
     * Search with full options in the body — supports fields, boost, prefix,
     * fuzzy, combineWith, maxResults. The GET /search/:term route remains for
     * simple term queries; this POST variant exposes the field-aware options.
     */
    app.post(...route('/services/searching/api/search/:searchContainer?'),
      validate({ body: { query: { type: 'string', required: true, maxLength: 1000 } } }),
      async (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const { query, ...searchOpts } = body;
        if (!query || typeof query !== 'string') {
          return res.status(400).json({ error: 'Missing query in request body' });
        }
        const containerName = req.params.searchContainer || searchOpts.containerName || 'default';
        const results = await search.search(query, { ...searchOpts, containerName });
        res.status(200).json(results);
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * POST /services/searching/api/add-bulk
     * Adds an array of documents in one call. Each document must contain the
     * configured idField (default: 'id'). Returns counts of added/skipped.
     */
    app.post('/services/searching/api/add-bulk', async (req, res) => {
      try {
        if (typeof search.addAll !== 'function') {
          return res.status(501).json({ error: 'addAll not supported by this provider' });
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const documents = Array.isArray(body) ? body : body.documents;
        if (!Array.isArray(documents)) {
          return res.status(400).json({ error: 'Expected an array or { documents: [...] }' });
        }
        // P2-7: bound batch size so one request cannot index an unbounded array.
        const MAX_BULK_DOCUMENTS = Number(process.env.SEARCH_MAX_BULK_DOCUMENTS) || 1000;
        if (documents.length > MAX_BULK_DOCUMENTS) {
          return res.status(413).json({ error: `At most ${MAX_BULK_DOCUMENTS} documents per request` });
        }
        const containerName = (body && body.searchContainer) || req.query.searchContainer || 'default';
        const result = await search.addAll(documents, containerName);
        res.status(200).json({ success: true, ...result });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * POST /services/searching/api/replace
     * Replace (or insert) a document using its idField.
     */
    app.post('/services/searching/api/replace', async (req, res) => {
      try {
        if (typeof search.replace !== 'function') {
          return res.status(501).json({ error: 'replace not supported by this provider' });
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const containerName = req.query.searchContainer
          || (body && body.searchContainer)
          || 'default';
        const document = body.document || body;
        await search.replace(document, containerName);
        res.status(200).json({ success: true });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * POST /services/searching/api/delete-bulk
     * Remove many documents in one call. Body is an array of ids or
     * { ids: [...], searchContainer }.
     */
    app.post('/services/searching/api/delete-bulk', async (req, res) => {
      try {
        if (typeof search.removeAll !== 'function') {
          return res.status(501).json({ error: 'removeAll not supported by this provider' });
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const ids = Array.isArray(body) ? body : body.ids;
        if (!Array.isArray(ids)) {
          return res.status(400).json({ error: 'Expected an array or { ids: [...] }' });
        }
        const containerName = (body && body.searchContainer) || req.query.searchContainer || 'default';
        const result = await search.removeAll(ids, containerName);
        res.status(200).json({ success: true, ...result });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * POST /services/searching/api/rebuild
     * Triggers a rebuild of the search index (for token-based providers).
     *
     * @param {express.Request} req - Express request object
     * @param {string} [req.body.searchContainer] - Optional container name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/searching/api/rebuild', (req, res) => {
      try {
        if (!search.rebuild && !search.loadFromDisk) {
          return res.status(501).json({
            error: 'Rebuild not supported by this search provider'
          });
        }

        const searchContainer = req.body?.searchContainer;

        // Trigger rebuild in background
        setImmediate(() => {
          if (search.rebuild) {
            search.rebuild(searchContainer).catch(error => {
              eventEmitter?.emit('search:rebuild:error', { error: error.message });
            });
          }
        });

        res.status(202).json({
          success: true,
          message: 'Index rebuild started in background'
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });



    /**
     * Semantic search (feature 01). Available on the vector provider only; the
     * other providers answer 409 so a client knows to pick a semantic one.
     *
     * @param {express.Response} res
     * @return {boolean} True when the provider supports semantic search
     */
    const semanticReady = (res) => {
      if (typeof search.semanticStatus === 'function' && typeof search.similar === 'function') return true;
      res.status(409).json({ error: 'Semantic search needs the vector searching provider (searching(\'vector\'))' });
      return false;
    };

    /**
     * GET /services/searching/api/semantic/status
     * Embedding backend, model, dimensions, pending embeddings and the last error.
     */
    app.get('/services/searching/api/semantic/status', (req, res) => {
      if (!semanticReady(res)) return;
      res.status(200).json(search.semanticStatus());
    });

    /**
     * POST /services/searching/api/semantic/search
     * Body: { query, containerName?, mode?: 'semantic'|'hybrid'|'keyword', k?, minScore? }.
     * Returns the ranked hits with their scores.
     */
    app.post('/services/searching/api/semantic/search',
      validate({
        body: {
          query: { type: 'string', required: true, maxLength: 1000 },
          mode: { type: 'string', enum: ['semantic', 'hybrid', 'keyword'] },
          containerName: { type: 'string', maxLength: 128 },
          k: { type: 'number', min: 1, max: 200 },
          minScore: { type: 'number', min: -1, max: 1 }
        }
      }),
      async (req, res) => {
        if (!semanticReady(res)) return;
        try {
          const { query, containerName, ...opts } = req.body;
          const results = await search.search(query, { ...opts, containerName: containerName || 'default' });
          res.status(200).json({ query, mode: opts.mode || null, results });
        } catch (error) {
          sendSafeError(res, error, { status: 500, eventEmitter });
        }
      });

    /**
     * POST /services/searching/api/semantic/flush
     * Body: { containerName? }. Waits until queued embeddings are applied.
     */
    app.post('/services/searching/api/semantic/flush', async (req, res) => {
      if (!semanticReady(res)) return;
      try {
        const containerName = req.body && typeof req.body.containerName === 'string' ? req.body.containerName : undefined;
        await search.flushEmbeddings(containerName);
        res.status(200).json({ success: true, pending: search.semanticStatus().pendingEmbeddings });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/searching/api/semantic/similar/:id?containerName=
     * Documents nearest to a stored document, by vector.
     */
    app.get('/services/searching/api/semantic/similar/:id', async (req, res) => {
      if (!semanticReady(res)) return;
      try {
        const containerName = typeof req.query.containerName === 'string' ? req.query.containerName : 'default';
        const results = await search.similar(req.params.id, { containerName });
        res.status(200).json({ id: req.params.id, results });
      } catch (error) {
        // Unknown or not yet embedded documents are a client question, not a fault.
        if (/no vector for/.test(error.message)) return res.status(404).json({ error: 'No vector for that document yet' });
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

  }
};