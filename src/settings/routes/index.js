/**
 * @fileoverview Settings API routes for Express.js application.
 * Provides RESTful endpoints for reading and updating grouped key/value
 * settings held in the encrypted settings store, plus the provider
 * configuration endpoints used by the service settings screen.
 *
 * Secret values are masked by default; pass `?reveal=true` on read endpoints
 * to retrieve them in clear text.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');

/**
 * Configures and registers settings routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} [options.authMiddleware] - Optional API key middleware
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} settings - The settings provider instance
 * @return {void}
 */
module.exports = (options, eventEmitter, settings) => {
  if (!options['express-app'] || !settings) return;

  const app = options['express-app'];
  const guard = options.authMiddleware || ((req, res, next) => next());

  // Enforce authentication on every settings API endpoint via a single
  // path-mounted guard. This closes the gaps where /status and the provider
  // configuration endpoints (GET/POST /api/settings) were unguarded while the
  // key/value store routes carried an inline guard. Individual routes below no
  // longer need to repeat the guard. Falls back to a pass-through only when no
  // auth is configured.
  app.use('/services/settings/api', guard);

  /**
   * Whether the caller asked for secret values in clear text.
   *
   * @param {express.Request} req - Express request object
   * @return {boolean} True when secrets should be revealed
   */
  const wantsReveal = (req) => req.query.reveal === 'true' || req.query.reveal === '1';

  /**
   * Maps a provider error onto an HTTP status code.
   * Unknown groups are 404, validation problems are 400, anything else is 500.
   *
   * @param {Error} error - The thrown error
   * @return {number} HTTP status code
   */
  const statusForError = (error) => {
    const message = error.message || '';
    if (message.startsWith('Unknown settings group')) return 404;
    if (message.startsWith('Invalid') || message.includes('already exists')) return 400;
    return 500;
  };

  /**
   * Wraps an async handler with consistent error reporting.
   *
   * @param {string} operation - Operation name used in emitted events
   * @param {Function} handler - Async Express handler
   * @return {Function} Express route handler
   */
  const route = (operation, handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      eventEmitter.emit('api-settings-error', {
        operation,
        error: error.message
      });
      // 4xx messages are service-crafted and safe; never echo 5xx internals (P1-2).
      const status = statusForError(error);
      res.status(status).json({
        success: false,
        error: status >= 500 ? 'Internal Server Error' : error.message
      });
    }
  };

  /**
   * GET /services/settings/api/status
   * Returns the operational status of the settings service.
   */
  app.get('/services/settings/api/status', (req, res) => {
    eventEmitter.emit('api-settings-status', 'settings api running');
    res.status(200).json('settings api running');
  });

  /**
   * GET /services/settings/api/statistics
   * Returns counts and encrypted file information for the dashboard.
   */
  app.get('/services/settings/api/statistics', route('statistics', async (req, res) => {
    const statistics = await settings.getStatistics();
    res.status(200).json({ success: true, statistics });
  }));

  /**
   * GET /services/settings/api/groups
   * Lists every settings group with its key and secret counts.
   */
  app.get('/services/settings/api/groups', route('list-groups', async (req, res) => {
    const groups = await settings.listGroups();
    res.status(200).json({ success: true, groups, total: groups.length });
  }));

  /**
   * POST /services/settings/api/groups
   * Creates a settings group.
   *
   * @param {string} req.body.name - Group name
   * @param {string} [req.body.description] - Group description
   */
  app.post('/services/settings/api/groups', route('create-group', async (req, res) => {
    const { name, description } = req.body || {};
    if (!name) {
      return res.status(400).json({ success: false, error: 'Missing group name' });
    }
    const group = await settings.createGroup(name, description);
    res.status(201).json({ success: true, group });
  }));

  /**
   * GET /services/settings/api/groups/:group
   * Returns a group with per-key metadata for the admin screen.
   */
  app.get('/services/settings/api/groups/:group', route('get-group', async (req, res) => {
    const group = await settings.getGroupDetail(req.params.group, {
      reveal: wantsReveal(req)
    });
    res.status(200).json({ success: true, group });
  }));

  /**
   * PUT /services/settings/api/groups/:group
   * Updates a group description.
   *
   * @param {string} req.body.description - New description
   */
  app.put('/services/settings/api/groups/:group', route('update-group', async (req, res) => {
    const group = await settings.updateGroup(
      req.params.group, (req.body || {}).description);
    res.status(200).json({ success: true, group });
  }));

  /**
   * DELETE /services/settings/api/groups/:group
   * Deletes a group and every setting it contains. The default group is
   * emptied rather than removed.
   */
  app.delete('/services/settings/api/groups/:group', route('delete-group', async (req, res) => {
    const deleted = await settings.deleteGroup(req.params.group);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Unknown settings group' });
    }
    res.status(200).json({ success: true });
  }));

  /**
   * GET /services/settings/api/values
   * Returns every group as a nested key/value object.
   */
  app.get('/services/settings/api/values', route('get-all', async (req, res) => {
    const values = await settings.getAll({ reveal: wantsReveal(req) });
    res.status(200).json({ success: true, values });
  }));

  /**
   * POST /services/settings/api/values
   * Merges a nested `{group: {key: value}}` object into the store.
   *
   * @param {Object} req.body.values - Groups to import
   * @param {boolean} [req.body.replace] - Empty the store before importing
   */
  app.post('/services/settings/api/values', route('import', async (req, res) => {
    const { values, replace } = req.body || {};
    if (!values) {
      return res.status(400).json({ success: false, error: 'Missing values' });
    }
    const result = await settings.import(values, { replace: replace === true });
    res.status(200).json({ success: true, ...result });
  }));

  /**
   * GET /services/settings/api/values/:group/:key
   * Reads a single setting value.
   */
  app.get('/services/settings/api/values/:group/:key', route('get-value', async (req, res) => {
    const { group, key } = req.params;
    const exists = await settings.has(key, group);
    if (!exists) {
      return res.status(404).json({ success: false, error: 'Unknown setting' });
    }

    const meta = await settings.getMeta(key, group);
    const value = meta?.secret && !wantsReveal(req)
      ? '********'
      : await settings.get(key, group);

    res.status(200).json({ success: true, group, key, value, meta });
  }));

  /**
   * POST /services/settings/api/values/:group/:key
   * Creates or updates a setting. The group is created when missing.
   *
   * @param {*} req.body.value - Value to store
   * @param {boolean} [req.body.secret] - Mask this value when listing settings
   * @param {string} [req.body.description] - Human readable description
   * @param {string} [req.body.type] - Type hint for the admin screen
   */
  const writeValue = route('set-value', async (req, res) => {
    const { group, key } = req.params;
    const body = req.body || {};

    if (!('value' in body)) {
      return res.status(400).json({ success: false, error: 'Missing value' });
    }

    await settings.set(key, body.value, group, {
      secret: body.secret,
      description: body.description,
      type: body.type
    });

    res.status(200).json({ success: true, group, key });
  });

  app.post('/services/settings/api/values/:group/:key', writeValue);
  app.put('/services/settings/api/values/:group/:key', writeValue);

  /**
   * DELETE /services/settings/api/values/:group/:key
   * Removes a setting.
   */
  app.delete('/services/settings/api/values/:group/:key', route('delete-value', async (req, res) => {
    const { group, key } = req.params;
    const deleted = await settings.delete(key, group);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Unknown setting' });
    }
    res.status(200).json({ success: true });
  }));

  /**
   * POST /services/settings/api/reload
   * Discards the in-memory copy and decrypts the file again.
   */
  app.post('/services/settings/api/reload', route('reload', async (req, res) => {
    await settings.reload();
    res.status(200).json({ success: true });
  }));

  /**
   * GET /services/settings/api/settings
   * Retrieves the provider configuration for the service settings screen.
   */
  app.get('/services/settings/api/settings', route('get-settings', async (req, res) => {
    const providerSettings = await settings.getSettings();
    res.status(200).json(providerSettings);
  }));

  /**
   * POST /services/settings/api/settings
   * Updates the provider configuration for the settings service.
   */
  app.post('/services/settings/api/settings', route('save-settings', async (req, res) => {
    const message = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing settings' });
    }
    await settings.saveSettings(message);
    res.status(200).json({ success: true });
  }));

  // ---------------------------------------------------------------------------
  // Feature flags (feature 13). Managing flags needs settings:manage. Evaluating
  // needs flags:evaluate, and always uses the caller's own identity, never
  // roles or ids supplied in the body.
  // ---------------------------------------------------------------------------

  /**
   * GET /services/settings/api/flags
   * Lists every flag with its definition, timestamps and last evaluation time.
   */
  app.get('/services/settings/api/flags', route('list-flags', async (req, res) => {
    const flags = await settings.flags.list();
    res.status(200).json({ success: true, flags });
  }));

  /**
   * PUT /services/settings/api/flags/:name
   * Creates or replaces a flag definition.
   */
  app.put('/services/settings/api/flags/:name', route('save-flag', async (req, res) => {
    const definition = await settings.flags.set(req.params.name, req.body);
    res.status(200).json({ success: true, flag: { name: req.params.name, ...definition } });
  }));

  /**
   * DELETE /services/settings/api/flags/:name
   * Removes a flag definition.
   */
  app.delete('/services/settings/api/flags/:name', route('delete-flag', async (req, res) => {
    const deleted = await settings.flags.delete(req.params.name);
    res.status(200).json({ success: true, deleted });
  }));

  /**
   * POST /services/settings/api/flags/:name/evaluate
   * Evaluates a flag for the signed-in caller. Frontends use this for
   * `isEnabled`. Identity comes from the session or token, never the body.
   */
  app.post('/services/settings/api/flags/:name/evaluate', route('evaluate-flag', async (req, res) => {
    const user = req.user || {};
    const context = {
      userId: user.id || user.email || req.userEmail || undefined,
      email: user.email || req.userEmail || undefined,
      roles: Array.isArray(user.roles) ? user.roles : (Array.isArray(req.userRoles) ? req.userRoles : [])
    };
    const result = await settings.flags.evaluate(req.params.name, context);
    res.status(200).json({ success: true, ...result });
  }));

  // Advise that we have loaded routes
  eventEmitter.emit('settings:loading routes', {
    folder: path.join(__dirname)
  });
};
