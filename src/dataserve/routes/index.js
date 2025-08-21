/**
 * @fileoverview Data serving API routes for Express.js application.
 * Provides RESTful endpoints for data storage and retrieval operations
 * including put, get, delete, and status monitoring.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers data serving routes with the Express application.
 * Sets up endpoints for persistent data management operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} dataserve - The data serving provider instance
 * @return {void}
 */
module.exports = (options, eventEmitter, dataserve) => {
  if (options['express-app'] && dataserve) {
    const app = options['express-app'];

    /**
     * POST /services/dataserve/api/put/:key
     * Stores data with the specified key in the data serving system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The key to store the data under
     * @param {*} req.body - The data to store
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/dataserve/api/put/:key', (req, res) => {
      const key = req.params.key;
      const value = req.body;
      dataserve
        .put(key, value)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/dataserve/api/get/:key
     * Retrieves data by key from the data serving system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The key to retrieve data for
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataserve/api/get/:key', (req, res) => {
      const key = req.params.key;
      dataserve
        .get(key)
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * DELETE /services/dataserve/api/delete/:key
     * Removes data by key from the data serving system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The key to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/dataserve/api/delete/:key', (req, res) => {
      const key = req.params.key;
      dataserve
        .delete(key)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/dataserve/api/status
     * Returns the operational status of the data serving service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/dataserve/api/status', (req, res) => {
      eventEmitter.emit('api-dataserve-status', 'dataserve api running');
      res.status(200).json('dataserve api running');
    });
  }
};
