/**
 * @fileoverview File management API routes for Express.js application.
 * Provides RESTful endpoints for file operations including upload, download,
 * removal, and status monitoring across multiple storage backends.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers file management routes with the Express application.
 * Sets up endpoints for file storage operations across different providers.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} filing - The filing service instance with upload/download methods
 * @return {void}
 */
module.exports = (options, eventEmitter, filing) => {
  if (options['express-app'] && filing) {
    const app = options['express-app'];

    /**
     * POST /services/filing/api/upload/:key
     * Uploads a file with the specified key to the filing system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to upload to
     * @param {*} req.body - The file data to upload
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/filing/api/upload/:key', (req, res) => {
      const key = req.params.key;
      const value = req.body;
      filing
        .upload(key, value)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/filing/api/download/:key
     * Downloads a file by key from the filing system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to download
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/download/:key', (req, res) => {
      const key = req.params.key;
      filing
        .download(key)
        .then((value) => res.status(200).json(value))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * DELETE /services/filing/api/remove/:key
     * Removes a file by key from the filing system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to remove
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/filing/api/remove/:key', (req, res) => {
      const key = req.params.key;
      filing
        .remove(key)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/filing/api/status
     * Returns the operational status of the filing service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/status', (req, res) => {
      eventEmitter.emit('api-filing-status', 'filing api running');
      res.status(200).json('filing api running');
    });
  }
};
