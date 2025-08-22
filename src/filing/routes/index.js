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

    // Sync-specific routes (available when using sync filing provider)

    /**
     * POST /services/filing/api/sync/files
     * Synchronizes specific files between local and remote repositories.
     * Body: { files: ["path1", "path2", ...] }
     *
     * @param {express.Request} req - Express request object
     * @param {Array<string>} req.body.files - Array of file paths to sync
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/files', async (req, res) => {
      try {
        if (!filing.syncFile) {
          return res.status(400).json({ error: 'Sync operations not supported by this provider' });
        }

        const { files } = req.body;
        if (!files || !Array.isArray(files)) {
          return res.status(400).json({ error: 'Files array is required' });
        }

        const results = [];
        for (const filePath of files) {
          try {
            await filing.syncFile(filePath);
            results.push({ path: filePath, status: 'synced' });
          } catch (error) {
            results.push({ path: filePath, status: 'error', error: error.message });
          }
        }

        res.status(200).json({
          message: 'File sync completed',
          results,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/sync/lock/:key
     * Locks a file for exclusive editing.
     * Body: { reason?: string }
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to lock
     * @param {string} [req.body.reason] - Optional reason for locking
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/lock/:key', async (req, res) => {
      try {
        if (!filing.lockFile) {
          return res.status(400).json({ error: 'File locking not supported by this provider' });
        }

        const key = req.params.key;
        const { reason = 'Locked via API' } = req.body || {};

        await filing.lockFile(key, reason);

        res.status(200).json({
          message: 'File locked successfully',
          key,
          reason,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/sync/unlock/:key
     * Unlocks a file.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to unlock
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/unlock/:key', async (req, res) => {
      try {
        if (!filing.unlockFile) {
          return res.status(400).json({ error: 'File unlocking not supported by this provider' });
        }

        const key = req.params.key;
        await filing.unlockFile(key);

        res.status(200).json({
          message: 'File unlocked successfully',
          key,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /services/filing/api/sync/status
     * Returns the synchronization status of all files.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.get('/services/filing/api/sync/status', async (req, res) => {
      try {
        if (!filing.getSyncStatus) {
          return res.status(400).json({ error: 'Sync status not supported by this provider' });
        }

        const status = await filing.getSyncStatus();

        res.status(200).json({
          ...status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/sync/push
     * Pushes local changes to the remote repository.
     * Body: { files?: ["path1", "path2", ...] } - if not provided, pushes all modified files
     *
     * @param {express.Request} req - Express request object
     * @param {Array<string>} [req.body.files] - Optional array of specific files to push
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/push', async (req, res) => {
      try {
        if (!filing.pushFile || !filing.getSyncStatus) {
          return res.status(400).json({ error: 'Push operations not supported by this provider' });
        }

        const { files } = req.body || {};
        let filesToPush;

        if (files && Array.isArray(files)) {
          filesToPush = files;
        } else {
          // Push all modified files
          const status = await filing.getSyncStatus();
          filesToPush = status.modified || [];
        }

        const results = [];
        for (const filePath of filesToPush) {
          try {
            await filing.pushFile(filePath);
            results.push({ path: filePath, status: 'pushed' });
          } catch (error) {
            results.push({ path: filePath, status: 'error', error: error.message });
          }
        }

        res.status(200).json({
          message: 'Push completed',
          results,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/sync/pull
     * Pulls remote changes to the local repository.
     * Body: { files?: ["path1", "path2", ...] } - if not provided, syncs all clean files
     *
     * @param {express.Request} req - Express request object
     * @param {Array<string>} [req.body.files] - Optional array of specific files to pull
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/pull', async (req, res) => {
      try {
        if (!filing.pullFile || !filing.syncAll) {
          return res.status(400).json({ error: 'Pull operations not supported by this provider' });
        }

        const { files } = req.body || {};

        if (files && Array.isArray(files)) {
          const results = [];
          for (const filePath of files) {
            try {
              await filing.pullFile(filePath);
              results.push({ path: filePath, status: 'pulled' });
            } catch (error) {
              results.push({ path: filePath, status: 'error', error: error.message });
            }
          }

          res.status(200).json({
            message: 'Pull completed',
            results,
            timestamp: new Date().toISOString()
          });
        } else {
          // Sync all files
          await filing.syncAll();
          res.status(200).json({
            message: 'Full sync completed',
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/sync/notify-change
     * Notifies the sync system of remote changes.
     * Body: { files: ["path1", "path2", ...] }
     *
     * @param {express.Request} req - Express request object
     * @param {Array<string>} req.body.files - Array of file paths that changed remotely
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/notify-change', async (req, res) => {
      try {
        if (!filing.processRemoteChanges) {
          return res.status(400).json({ error: 'Remote change processing not supported by this provider' });
        }

        const { files } = req.body;
        if (!files || !Array.isArray(files)) {
          return res.status(400).json({ error: 'Files array is required' });
        }

        await filing.processRemoteChanges(files);

        res.status(200).json({
          message: 'Remote changes processed successfully',
          files,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/sync/auto/start
     * Starts automatic synchronization.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/auto/start', (req, res) => {
      try {
        if (!filing.startAutoSync) {
          return res.status(400).json({ error: 'Auto sync not supported by this provider' });
        }

        filing.startAutoSync();

        res.status(200).json({
          message: 'Auto sync started',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/sync/auto/stop
     * Stops automatic synchronization.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/sync/auto/stop', (req, res) => {
      try {
        if (!filing.stopAutoSync) {
          return res.status(400).json({ error: 'Auto sync not supported by this provider' });
        }

        filing.stopAutoSync();

        res.status(200).json({
          message: 'Auto sync stopped',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Git-specific routes (available when using Git filing provider)

    /**
     * POST /services/filing/api/git/commit
     * Commits pending changes with a user-provided message.
     * Body: { commitId: string, message: string, userId?: string }
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.body.commitId - The pending commit ID
     * @param {string} req.body.message - The commit message
     * @param {string} [req.body.userId] - User ID for verification
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/git/commit', async (req, res) => {
      try {
        if (!filing.commitWithMessage) {
          return res.status(400).json({ error: 'Git operations not supported by this provider' });
        }

        const { commitId, message, userId } = req.body;
        
        if (!commitId || !message) {
          return res.status(400).json({ error: 'commitId and message are required' });
        }

        const result = await filing.commitWithMessage(commitId, message, userId);

        res.status(200).json({
          message: 'Commit completed successfully',
          commitId,
          commitMessage: message,
          result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/git/push
     * Pushes committed changes to the remote repository.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/git/push', async (req, res) => {
      try {
        if (!filing.push) {
          return res.status(400).json({ error: 'Git push not supported by this provider' });
        }

        const result = await filing.push();

        res.status(200).json({
          message: 'Push completed successfully',
          result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/git/fetch
     * Fetches changes from the remote repository.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/git/fetch', async (req, res) => {
      try {
        if (!filing.fetch) {
          return res.status(400).json({ error: 'Git fetch not supported by this provider' });
        }

        await filing.fetch();

        res.status(200).json({
          message: 'Fetch completed successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /services/filing/api/git/status
     * Returns the Git repository status and pending commits.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.get('/services/filing/api/git/status', async (req, res) => {
      try {
        if (!filing.getGitStatus) {
          return res.status(400).json({ error: 'Git status not supported by this provider' });
        }

        const status = await filing.getGitStatus();

        res.status(200).json({
          ...status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * GET /services/filing/api/git/pending
     * Gets pending commits waiting for messages.
     * Query: ?userId=string (optional)
     *
     * @param {express.Request} req - Express request object
     * @param {string} [req.query.userId] - Filter by user ID
     * @param {express.Response} res - Express response object
     */
    app.get('/services/filing/api/git/pending', (req, res) => {
      try {
        if (!filing.getPendingCommits) {
          return res.status(400).json({ error: 'Pending commits not supported by this provider' });
        }

        const { userId } = req.query;
        const pendingCommits = filing.getPendingCommits(userId);

        res.status(200).json({
          pendingCommits,
          count: pendingCommits.length,
          userId: userId || 'all',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * DELETE /services/filing/api/git/pending/:commitId
     * Cancels a pending commit.
     * Body: { userId?: string }
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.commitId - The commit ID to cancel
     * @param {string} [req.body.userId] - User ID for verification
     * @param {express.Response} res - Express response object
     */
    app.delete('/services/filing/api/git/pending/:commitId', async (req, res) => {
      try {
        if (!filing.cancelCommit) {
          return res.status(400).json({ error: 'Cancel commit not supported by this provider' });
        }

        const { commitId } = req.params;
        const { userId } = req.body || {};

        await filing.cancelCommit(commitId, userId);

        res.status(200).json({
          message: 'Commit cancelled successfully',
          commitId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/git/auto-fetch/start
     * Starts automatic fetching from remote repository.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/git/auto-fetch/start', (req, res) => {
      try {
        if (!filing.startAutoFetch) {
          return res.status(400).json({ error: 'Auto fetch not supported by this provider' });
        }

        filing.startAutoFetch();

        res.status(200).json({
          message: 'Auto fetch started',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * POST /services/filing/api/git/auto-fetch/stop
     * Stops automatic fetching from remote repository.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.post('/services/filing/api/git/auto-fetch/stop', (req, res) => {
      try {
        if (!filing.stopAutoFetch) {
          return res.status(400).json({ error: 'Auto fetch not supported by this provider' });
        }

        filing.stopAutoFetch();

        res.status(200).json({
          message: 'Auto fetch stopped',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }
};

// Note: Make sure to install multer as a dependency:
// npm install multer
