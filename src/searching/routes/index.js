/**
 * @fileoverview Search engine API routes for Express.js application.
 * Provides RESTful endpoints for document indexing, search operations,
 * content removal, and service status monitoring with UUID-based keys.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const crypto = require('crypto');

/**
 * Configures and registers search routes with the Express application.
 * Sets up endpoints for search index management and query operations.
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

    /**
     * POST /services/searching/api/add/
     * Adds content to the search index with an auto-generated UUID key.
     *
     * @param {express.Request} req - Express request object
     * @param {*} req.body - The content to add to the search index
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/searching/api/add/', (req, res) => {
      const key = crypto.randomUUID();
      const value = req.body;
      if (search.add(key, value)) {
        res.status(200).send('OK');
      } else {
        res.status(400).send('Bad Request: Key already exists.');
      }
    });

    /**
     * DELETE /services/searching/api/delete/:key
     * Removes content from the search index by key.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The UUID key of content to remove
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/searching/api/delete/:key', (req, res) => {
      const key = req.params.key;
      if (search.remove(key)) {
        res.status(200).send('OK');
      } else {
        res.status(404).send('Not Found: Key not found.');
      }
    });

    /**
     * GET /services/searching/api/search/:term
     * Performs a search query against the indexed content.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.term - The search term/query string
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/searching/api/search/:term', (req, res) => {
      const term = req.params.term;
      if (term) {
        search
          .search(term)
          .then((results) => res.status(200).json(results))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing query');
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
  }
};
