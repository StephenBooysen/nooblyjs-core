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

const multer = require('multer');
const upload = multer();

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
     * Accepts multipart/form-data with file upload or raw body data.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to upload to
     * @param {Buffer} req.file.buffer - The file buffer (when using multipart)
     * @param {*} req.body - The raw body data (when not using multipart)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/filing/api/upload/:key',
      upload.single('file'),
      (req, res) => {
        const key = req.params.key;
        let fileData;
        if (req.file) {
          fileData = req.file.buffer;
        } else if (req.body) {
          // Handle raw body data
          fileData = Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(req.body);
        } else {
          return res.status(400).send('No file data provided');
        }

        filing
          .upload(key, fileData)
          .then(() =>
            res
              .status(200)
              .json({ message: 'File uploaded successfully', key }),
          )
          .catch((err) => res.status(500).json({ error: err.message }));
      },
    );

    /**
     * GET /services/filing/api/download/:key
     * Downloads a file by key from the filing system.
     * Supports optional encoding query parameter.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to download
     * @param {string} [req.query.encoding] - Optional encoding (utf8, base64, etc.)
     * @param {boolean} [req.query.attachment] - Whether to send as attachment
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/download/:key', (req, res) => {
      const key = req.params.key;
      const encoding = req.query.encoding;
      const isAttachment = req.query.attachment === 'true';

      filing
        .download(key, encoding)
        .then((data) => {
          if (isAttachment) {
            // Set headers for file download
            const filename = key.split('/').pop() || 'download';
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${filename}"`,
            );

            if (Buffer.isBuffer(data)) {
              res.setHeader('Content-Type', 'application/octet-stream');
              res.send(data);
            } else {
              res.setHeader('Content-Type', 'text/plain');
              res.send(data);
            }
          } else {
            // Return as JSON or raw data
            if (Buffer.isBuffer(data)) {
              res.setHeader('Content-Type', 'application/octet-stream');
              res.send(data);
            } else {
              res.status(200).json({ data, encoding: encoding || 'buffer' });
            }
          }
        })
        .catch((err) => res.status(500).json({ error: err.message }));
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
        .then(() =>
          res.status(200).json({ message: 'File removed successfully', key }),
        )
        .catch((err) => res.status(500).json({ error: err.message }));
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
      res.status(200).json({
        status: 'filing api running',
        timestamp: new Date().toISOString(),
      });
    });

    /**
     * POST /services/filing/api/upload-stream/:key
     * Uploads a file using streaming for large files.
     *
     * @param {express.Request} req - Express request object with streaming body
     * @param {string} req.params.key - The file key/path to upload to
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/filing/api/upload-stream/:key', (req, res) => {
      const key = req.params.key;

      filing
        .upload(key, req)
        .then(() =>
          res
            .status(200)
            .json({ message: 'File uploaded successfully via stream', key }),
        )
        .catch((err) => res.status(500).json({ error: err.message }));
    });
  }
};

// Note: Make sure to install multer as a dependency:
// npm install multer
