/**
 * @fileoverview File management API routes for Express.js application.
 * Provides RESTful endpoints for file operations including upload, download,
 * removal, and status monitoring across multiple storage backends.
 * Supports multiple named instances of the filing service.
 *
 * @author NooblyJS Core Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const { sendSafeError } = require('../../shared/utils/safeError');
const { route } = require('../../shared/utils/routePattern');

const path = require('node:path');
const express = require('express');
const { createUploadMiddleware, limitStream, resolveUploadLimits } = require('../modules/uploadLimits');
const analytics = require('../modules/analytics');
const { getServiceInstance } = require('../../appservice/utils/routeUtils');
const { parseLimit, parseOffset } = require('../../shared/utils/validation');
const { createFilingAccessGuard } = require('../modules/access');
const { sendFileContent } = require('../modules/contentServing');

/**
 * Extracts the uploaded bytes from a request: the multipart file, or a raw
 * Buffer/string body. Parsed bodies (e.g. JSON objects from express.json())
 * and empty bodies are not file data and yield null, so the caller can answer
 * 400 instead of throwing from Buffer.from() outside its try/catch — an
 * unhandled rejection that would shut the server down.
 *
 * @param {express.Request} req - Express request object
 * @return {?Buffer} The file bytes, or null when none were sent
 */
function getUploadData(req) {
  if (req.file) {
    return req.file.buffer;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    return Buffer.from(req.body);
  }
  return null;
}

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
    const currentInstanceName = options.instanceName || 'default';
    const ServiceRegistry = options.ServiceRegistry;
    const providerType = options.providerType || filing.providerType || 'local';

    // P0-1: Enforce authentication on every filing API endpoint. The filing API
    // is intentionally excluded from the /services portal *admin* guard so that
    // non-admin users (web wiki, Teams, Chrome extension) can read/write
    // documents — but it must still require a valid API key or an authenticated
    // session. The shared API-key middleware enforces exactly that (it accepts
    // an authenticated Passport session in lieu of an API key); without it these
    // routes were reachable anonymously.
    const requireApiAuth = options.authMiddleware || ((req, res, next) => next());
    // Feature 15: the portal exemption must not hand every signed-in user the
    // whole API. Route tiers (read / write / admin) are enforced here.
    app.use('/services/filing/api', requireApiAuth, createFilingAccessGuard(options, eventEmitter));

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
      ...route('/services/filing/api/upload/*'),
      createUploadMiddleware(() => filing, { eventEmitter }),
      async (req, res) => {
        const key = req.params[0];
        const fileData = getUploadData(req);
        if (!fileData) {
          return res.status(400).send('No file data provided');
        }

        try {
          await filing.upload(key, fileData);
          analytics.trackWrite(key);
          res
            .status(200)
            .json({ message: 'File uploaded successfully', key });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
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
    app.get(...route('/services/filing/api/download/*'), async (req, res) => {
      const key = req.params[0];
      const encoding = req.query.encoding;
      const isAttachment = req.query.attachment === 'true' || req.query.download === 'true';

      try {
        const data = await filing.download(key, encoding);
        analytics.trackRead(key);
        // Feature 17: active types are always opaque downloads; inline
        // responses are sandboxed.
        sendFileContent(res, key, data, { attachment: isAttachment, encoding });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
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
    app.delete(...route('/services/filing/api/remove/*'), async (req, res) => {
      const key = req.params[0];
      try {
        await filing.remove(key);
        analytics.trackDelete(key);
        res.status(200).json({ message: 'File removed successfully', key });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
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
     * GET /services/filing/api/instances
     * Returns a list of all available filing service instances.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/instances', (req, res) => {
      try {
        const instances = [];

        // Add the default instance
        instances.push({
          name: 'default',
          provider: providerType,
          status: 'active'
        });

        // Get additional instances from ServiceRegistry if available
        if (ServiceRegistry) {
          const additionalInstances = ServiceRegistry.listInstances('filing');
          if (additionalInstances && Array.isArray(additionalInstances)) {
            additionalInstances.forEach(instance => {
              // Skip the default instance to avoid duplication
              if (instance.instanceName !== 'default') {
                instances.push({
                  name: instance.instanceName,
                  provider: instance.providerType,
                  status: 'active'
                });
              }
            });
          }
        }

        eventEmitter.emit('api-filing-instances', `retrieved ${instances.length} instances`);
        res.status(200).json({
          success: true,
          instances: instances,
          total: instances.length
        });
      } catch (error) {
        eventEmitter.emit('api-filing-instances-error', error.message);
        res.status(500).json({
          success: false,
          error: 'Failed to list instances'
        });
      }
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
    app.post(...route('/services/filing/api/upload-stream/*'), async (req, res) => {
      const key = req.params[0];

      try {
        // Enforce maxFileSize while streaming (P2-2).
        const { maxFileSize } = resolveUploadLimits(filing);
        await filing.upload(key, limitStream(req, maxFileSize));
        analytics.trackWrite(key);
        res
          .status(200)
          .json({ message: 'File uploaded successfully via stream', key });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    // Instance-specific routes (multi-instance support)

    /**
     * POST /services/filing/api/:instanceName/upload/:key
     * Uploads a file to a named filing instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The filing instance name
     * @param {string} req.params.key - The file key/path to upload to
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      ...route('/services/filing/api/:instanceName/upload/*'),
      createUploadMiddleware(
        (req) => getServiceInstance('filing', req.params.instanceName, filing, options, providerType),
        { eventEmitter }
      ),
      async (req, res) => {
        const instanceName = req.params.instanceName;
        const filingInstance = getServiceInstance('filing', instanceName, filing, options, providerType);
        const key = req.params[0];
        const fileData = getUploadData(req);
        if (!fileData) {
          return res.status(400).send('No file data provided');
        }

        try {
          await filingInstance.upload(key, fileData);
          analytics.trackWrite(key);
          res.status(200).json({ message: 'File uploaded successfully', key });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      }
    );

    /**
     * GET /services/filing/api/:instanceName/download/:key
     * Downloads a file from a named filing instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The filing instance name
     * @param {string} req.params.key - The file key/path to download
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/filing/api/:instanceName/download/*'), async (req, res) => {
      const instanceName = req.params.instanceName;
      const filingInstance = getServiceInstance('filing', instanceName, filing, options, providerType);
      const key = req.params[0];
      const encoding = req.query.encoding;
      const isAttachment = req.query.attachment === 'true' || req.query.download === 'true';

      try {
        const data = await filingInstance.download(key, encoding);
        analytics.trackRead(key);
        sendFileContent(res, key, data, { attachment: isAttachment, encoding });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/filing/api/:instanceName/remove/:key
     * Removes a file from a named filing instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The filing instance name
     * @param {string} req.params.key - The file key/path to remove
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(...route('/services/filing/api/:instanceName/remove/*'), async (req, res) => {
      const instanceName = req.params.instanceName;
      const filingInstance = getServiceInstance('filing', instanceName, filing, options, providerType);
      const key = req.params[0];

      try {
        await filingInstance.remove(key);
        analytics.trackDelete(key);
        res.status(200).json({ message: 'File removed successfully', key });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/filing/api/:instanceName/analytics
     * Returns analytics data for a named filing instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The filing instance name
     * @param {number} [req.query.limit] - Maximum number of entries to return
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/:instanceName/analytics', (req, res) => {
      const instanceName = req.params.instanceName;
      const filingInstance = getServiceInstance('filing', instanceName, filing, options, providerType);
      const limit = parseLimit(req.query.limit, { defaultValue: 250 });

      try {
        const analyticsData = analytics.getAnalytics(limit);
        const stats = analytics.getStats();

        res.status(200).json({
          stats,
          data: analyticsData,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/filing/api/:instanceName/browse/*
     * Browses the file structure of a named filing instance at the given path.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The filing instance name
     * @param {string} req.params[0] - The path to browse
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/filing/api/:instanceName/browse/*'), async (req, res) => {
      const instanceName = req.params.instanceName;
      const filingInstance = getServiceInstance('filing', instanceName, filing, options, providerType);
      const path = req.params[0] || '';

      try {
        let items;

        try {
          items = await filingInstance.list(path);
        } catch (err) {
          // If list fails on the current path, try to determine if it's a file
          try {
            await filingInstance.download(path, 'utf8');
            // If we can read it as a file, return error (path is a file, not a folder)
            return res.status(400).json({
              error: 'Path is a file, not a folder',
              path,
              type: 'file'
            });
          } catch (downloadErr) {
            // If both fail, return empty
            return res.status(200).json({ items: [], path });
          }
        }

        if (!items) {
          return res.status(200).json({ items: [], path });
        }

        // Process items - they already have type information from filingInstance.list()
        // Handle both new format (objects with type) and backward compatibility (strings)
        const processedItems = [];
        for (const item of items) {
          // Handle both new format (objects with type) and backward compatibility (strings)
          const itemName = typeof item === 'string' ? item : item.name;
          const itemType = typeof item === 'string' ? undefined : item.type;
          const itemPath = path ? `${path}/${itemName}` : itemName;

          let finalType = itemType; // Use provided type if available

          // If type wasn't provided (backward compatibility), try to determine it
          if (!finalType) {
            const analyticsData = analytics.getAnalytics(1000);
            const knownFilePaths = new Set(analyticsData.map(item => item.path));

            finalType = 'file'; // Default to file

            // Check if this exact path is known to be a file in analytics
            if (knownFilePaths.has(itemPath)) {
              finalType = 'file';
            } else {
              // Check if any known file path starts with this path (indicating it's a folder)
              const hasChildren = Array.from(knownFilePaths).some(filePath =>
                filePath.startsWith(itemPath + '/')
              );

              if (hasChildren) {
                finalType = 'folder';
              } else {
                // If not in analytics, try to determine by attempting to list it
                try {
                  await filingInstance.list(itemPath);
                  finalType = 'folder';
                } catch (err) {
                  // If list fails, try to read as file
                  try {
                    await filingInstance.download(itemPath, 'utf8');
                    finalType = 'file';
                  } catch (readErr) {
                    // Default based on whether item has a file extension
                    finalType = hasFileExtension(itemName) ? 'file' : 'folder';
                  }
                }
              }
            }
          }

          processedItems.push({
            name: itemName,
            path: itemPath,
            type: finalType
          });
        }

        res.status(200).json({
          path,
          items: processedItems,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/filing/api/:instanceName/settings
     * Retrieves settings for a named filing instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The filing instance name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/:instanceName/settings', async (req, res) => {
      const instanceName = req.params.instanceName;
      const filingInstance = getServiceInstance('filing', instanceName, filing, options, providerType);

      try {
        const settings = await filingInstance.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('api-filing-settings-error', err.message);
        res.status(500).json({
          error: 'Failed to retrieve settings'
        });
      }
    });

    /**
     * POST /services/filing/api/:instanceName/settings
     * Updates settings for a named filing instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The filing instance name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/filing/api/:instanceName/settings', async (req, res) => {
      const instanceName = req.params.instanceName;
      const filingInstance = getServiceInstance('filing', instanceName, filing, options, providerType);
      const message = req.body;

      if (message) {
        try {
          await filingInstance.saveSettings(message);
          res.status(200).send('OK');
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter, format: 'send' });
        }
      } else {
        res.status(400).send('Bad Request: Missing settings');
      }
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
            results.push({ path: filePath, status: 'error', error: 'Operation failed' });
          }
        }

        res.status(200).json({
          message: 'File sync completed',
          results,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
            results.push({ path: filePath, status: 'error', error: 'Operation failed' });
          }
        }

        res.status(200).json({
          message: 'Push completed',
          results,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
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
              results.push({ path: filePath, status: 'error', error: 'Operation failed' });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
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
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    // Analytics routes

    /**
     * GET /services/filing/api/analytics
     * Returns file operation analytics data.
     * Query: ?limit=number (optional, default 250)
     *
     * @param {express.Request} req - Express request object
     * @param {number} [req.query.limit] - Maximum number of entries to return
     * @param {express.Response} res - Express response object
     */
    app.get('/services/filing/api/analytics', (req, res) => {
      try {
        const limit = parseLimit(req.query.limit, { defaultValue: 250 });
        const analyticsData = analytics.getAnalytics(limit);
        const stats = analytics.getStats();

        res.status(200).json({
          stats,
          data: analyticsData,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/filing/api/analytics/stats
     * Returns aggregated analytics statistics.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.get('/services/filing/api/analytics/stats', (req, res) => {
      try {
        const stats = analytics.getStats();
        res.status(200).json({
          ...stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/filing/api/analytics
     * Clears all analytics data.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     */
    app.delete('/services/filing/api/analytics', (req, res) => {
      try {
        analytics.clear();
        res.status(200).json({
          message: 'Analytics data cleared successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/filing/api/browse/*
     * Browses the file structure at the given path.
     * Returns hierarchical file and folder structure.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params[0] - The path to browse (e.g., 'folder/subfolder')
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/filing/api/browse/*'), async (req, res) => {
      try {
        const path = req.params[0] || '';
        let items;

        try {
          items = await filing.list(path);
        } catch (err) {
          // If list fails on the current path, try to determine if it's a file
          try {
            await filing.download(path, 'utf8');
            // If we can read it as a file, return error (path is a file, not a folder)
            return res.status(400).json({
              error: 'Path is a file, not a folder',
              path,
              type: 'file'
            });
          } catch (downloadErr) {
            // If both fail, return empty
            return res.status(200).json({ items: [], path });
          }
        }

        if (!items) {
          return res.status(200).json({ items: [], path });
        }

        // Process items - they already have type information from filing.list()
        const processedItems = [];
        for (const item of items) {
          // Handle both new format (objects with type) and backward compatibility (strings)
          const itemName = typeof item === 'string' ? item : item.name;
          const itemType = typeof item === 'string' ? undefined : item.type;
          const itemPath = path ? `${path}/${itemName}` : itemName;

          let finalType = itemType; // Use provided type if available

          // If type wasn't provided (backward compatibility), try to determine it
          if (!finalType) {
            const analyticsData = analytics.getAnalytics(1000);
            const knownFilePaths = new Set(analyticsData.map(item => item.path));

            finalType = 'file'; // Default to file

            // Check if this exact path is known to be a file in analytics
            if (knownFilePaths.has(itemPath)) {
              finalType = 'file';
            } else {
              // Check if any known file path starts with this path (indicating it's a folder)
              const hasChildren = Array.from(knownFilePaths).some(filePath =>
                filePath.startsWith(itemPath + '/')
              );

              if (hasChildren) {
                finalType = 'folder';
              } else {
                // If not in analytics, try to determine by attempting to list it
                try {
                  await filing.list(itemPath);
                  finalType = 'folder';
                } catch (err) {
                  // If list fails, try to read as file
                  try {
                    await filing.download(itemPath, 'utf8');
                    finalType = 'file';
                  } catch (readErr) {
                    // Default based on whether item has a file extension
                    finalType = hasFileExtension(itemName) ? 'file' : 'folder';
                  }
                }
              }
            }
          }

          processedItems.push({
            name: itemName,
            path: itemPath,
            type: finalType
          });
        }

        res.status(200).json({
          path,
          items: processedItems,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * Helper function to check if an item name looks like a file
     * @param {string} name - The item name
     * @return {boolean} - True if it appears to be a file
     */
    function hasFileExtension(name) {
      // Check if the name has a file extension (dot followed by letters/numbers)
      return /\.[a-zA-Z0-9]+$/.test(name);
    }

    /**
     * GET /services/filing/api/file-tree
     * Returns the complete file tree structure built from analytics data.
     * Useful for advanced UI with hierarchical file browsing.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/file-tree', (req, res) => {
      try {
        const analyticsData = analytics.getAnalytics(500);
        const tree = buildFileTree(analyticsData);

        res.status(200).json({
          tree,
          totalPaths: analyticsData.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        sendSafeError(res, error, { status: 500, eventEmitter });
      }
    });

    /**
     * Helper function to build hierarchical file tree from analytics paths
     * @param {Array} analyticsData - Array of file paths from analytics
     * @return {Object} Hierarchical tree structure
     */
    function buildFileTree(analyticsData) {
      const tree = { name: 'root', type: 'folder', children: [] };

      analyticsData.forEach(item => {
        const pathParts = (item.path || '').split('/').filter(p => p);
        let current = tree;

        pathParts.forEach((part, index) => {
          if (!current.children) {
            current.children = [];
          }

          const isFile = index === pathParts.length - 1;
          let node = current.children.find(n => n.name === part);

          if (!node) {
            node = {
              name: part,
              path: pathParts.slice(0, index + 1).join('/'),
              type: isFile ? 'file' : 'folder',
              children: isFile ? undefined : []
            };
            current.children.push(node);
          } else if (isFile && node.type === 'folder') {
            // If we encounter a file path where we had a folder, keep it as folder
            // This handles cases where a path like 'documents' exists as both
            // a folder with children and potentially as a leaf node
            node.type = 'folder';
          }

          current = node;
        });
      });

      // Ensure all nodes with children are marked as folders
      const normalizeTypes = (node) => {
        if (node.children && node.children.length > 0) {
          node.type = 'folder';
          node.children.forEach(normalizeTypes);
        }
      };

      normalizeTypes(tree);

      // Sort children
      const sortChildren = (node) => {
        if (node.children) {
          node.children.sort((a, b) => {
            if (a.type === b.type) {
              return a.name.localeCompare(b.name);
            }
            return a.type === 'folder' ? -1 : 1;
          });
          node.children.forEach(sortChildren);
        }
      };

      sortChildren(tree);
      return tree;
    }

    /**
     * GET /services/filing/api/settings
     * Retrieves the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/settings', async (req, res) => {
      try {
        const settings = await filing.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('api-filing-settings-error', err.message);
        res.status(500).json({
          error: 'Failed to retrieve settings'
        });
      }
    });

    /**
     * POST /services/filing/api/settings
     * Updates the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/filing/api/settings', async (req, res) => {
      const message = req.body;
      if (message) {
        try {
          await filing.saveSettings(message);
          res.status(200).send('OK');
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter, format: 'send' });
        }
      } else {
        res.status(400).send('Bad Request: Missing settings');
      }
    });

    /**
     * GET /services/filing/api/pdf-preview/:key
     * Returns PDF metadata and text preview for the first page.
     * Useful for preview generation in the UI.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.key - The file key/path to the PDF
     * @param {number} [req.query.page] - The page number to preview (default: 1)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/filing/api/pdf-preview/:key', async (req, res) => {
      try {
        const key = req.params.key;
        const page = parseOffset(req.query.page, { defaultValue: 1, min: 1, max: 100000 });

        if (!key) {
          return res.status(400).json({ error: 'File key is required' });
        }

        // Verify it's a PDF file
        const ext = key.toLowerCase().split('.').pop();
        if (ext !== 'pdf') {
          return res.status(400).json({ error: 'File is not a PDF' });
        }

        try {
          // Dynamically require pdf-parse
          let pdfParse;
          try {
            pdfParse = require('pdf-parse');
          } catch (err) {
            return res.status(503).json({
              error: 'PDF preview service unavailable',
              message: 'pdf-parse package not installed. Install with: npm install pdf-parse'
            });
          }

          // Get the PDF file buffer
          const pdfBuffer = await filing.download(key);

          if (!pdfBuffer) {
            return res.status(404).json({ error: 'PDF file not found' });
          }

          // Parse PDF to get metadata and text
          try {
            const data = await pdfParse(pdfBuffer);

            // Extract text from requested page
            let pageText = '';
            if (data.text && page > 0 && page <= data.numpages) {
              // pdf-parse provides full text, we'll take a substring as preview
              const textPerPage = Math.ceil(data.text.length / data.numpages);
              const startIdx = (page - 1) * textPerPage;
              const endIdx = Math.min(startIdx + textPerPage, data.text.length);
              pageText = data.text.substring(startIdx, endIdx);
            }

            // Return PDF metadata and preview
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
            res.json({
              success: true,
              metadata: {
                numPages: data.numpages,
                currentPage: page,
                producer: data.producer || 'Unknown',
                creator: data.creator || 'Unknown',
                creationDate: data.creationDate,
                title: data.title || 'Untitled'
              },
              preview: {
                text: pageText.substring(0, 2000), // First 2000 characters as preview
                charCount: data.text.length,
                truncated: pageText.length > 2000
              }
            });

          } catch (error) {
            // Silently handle PDF parse error
            res.status(400).json({
              error: 'Failed to parse PDF'
            });
          }

        } catch (error) {
          // Silently handle PDF preview error
          res.status(500).json({
            error: 'Failed to process PDF preview'
          });
        }
      } catch (error) {
        // Silently handle PDF preview endpoint error
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Serve static files from the swagger directory for filing service
    app.use('/services/filing/api/swagger', express.static(path.join(__dirname, 'swagger')));

    // Advise that we have loaded routes
    eventEmitter.emit('filing:loading routes', {
      folder: path.join(__dirname),
    });
  }
};