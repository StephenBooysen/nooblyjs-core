/**
 * @fileoverview Caching API routes for Express.js application.
 * Provides RESTful endpoints for cache operations including put, get, delete,
 * status monitoring, and analytics retrieval.
 * 
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers caching routes with the Express application.
 * Sets up endpoints for cache management and monitoring operations.
 * 
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} cache - The caching provider instance with put/get/delete methods
 * @return {void}
 */
module.exports = (options, eventEmitter, cache) => {
  if (options['express-app'] && cache) {
    const app = options['express-app'];
    const authMiddleware = options.authMiddleware;

    /**
     * PUT /services/caching/api/put/:key
     * Stores a value in the cache with the specified key.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The cache key to store the value under
     * @param {*} req.body - The value to store in the cache
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/caching/api/put/:key',
      authMiddleware || ((req, res, next) => next()),
      (req, res) => {
        const key = req.params.key;
        const value = req.body;
        cache
          .put(key, value)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/caching/api/get/:key
     * Retrieves a value from the cache by key.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The cache key to retrieve
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/caching/api/get/:key',
      authMiddleware || ((req, res, next) => next()),
      (req, res) => {
        const key = req.params.key;
        cache
          .get(key)
          .then((value) => res.status(200).json(value))
          .catch((err) => res.status(500).send(err.message));
      },
    );

    /**
     * DELETE /services/caching/api/delete/:key
     * Removes a value from the cache by key.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The cache key to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/caching/api/delete/:key', authMiddleware || ((req, res, next) => next()), (req, res) => {
      const key = req.params.key;
      cache
        .delete(key)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/caching/api/status
     * Returns the operational status of the caching service.
     * 
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/caching/api/status', (req, res) => {
      eventEmitter.emit('api-cache-status', 'caching api running');
      res.status(200).json('caching api running');
    });

    /**
     * GET /services/caching/api/list
     * Retrieves analytics data for cache operations including hit counts and access times.
     * 
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/caching/api/list', authMiddleware || ((req, res, next) => next()), (req, res) => {
      try {
        const analytics = cache.getAnalytics ? cache.getAnalytics() : [];
        eventEmitter.emit('api-cache-list',
            `retrieved ${analytics.length} analytics entries`);
        res.status(200).json({
          success: true,
          data: analytics,
          total: analytics.length,
        });
      } catch (err) {
        eventEmitter.emit('api-cache-list-error', err.message);
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });
  }
};
