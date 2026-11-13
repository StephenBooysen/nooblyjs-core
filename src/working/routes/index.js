/**
 * @fileoverview HTTP routes for the working service.
 *
 * Mounts a REST API at `/services/working/api/*` for queueing tasks,
 * inspecting their state, and managing service settings. All handlers
 * convert validation failures into 4xx responses and unexpected failures
 * into 5xx responses, and route through the optional logger.
 *
 * @author NooblyJS Core Team
 * @version 2.0.0
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');
const express = require('express');
const { route } = require('../../shared/utils/routePattern');

/**
 * Returns true for plain integer-coercible positive numbers (used by query
 * params like `?limit=20`).
 * @param {*} value
 * @param {number} fallback
 * @return {number}
 */
function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  // P2-7: cap page sizes so a huge ?limit= cannot build an unbounded response.
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : fallback;
}

/**
 * Registers all working-service HTTP routes.
 *
 * @param {!Object} options Service options. Must include `'express-app'`.
 * @param {!EventEmitter} eventEmitter Event emitter for service lifecycle.
 * @param {!Object} worker The worker provider instance.
 * @param {!Object=} analytics The analytics module instance.
 * @return {void}
 */
module.exports = (options, eventEmitter, worker, analytics) => {
  if (!options || !options['express-app'] || !worker) return;

  const app = options['express-app'];
  const logger = worker.logger || null;

  /**
   * Wraps an async route handler so any thrown error becomes a 500 response
   * with structured logging instead of a stack trace leaking to the client.
   * @param {Function} handler
   */
  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      logger?.error?.('[WorkingRoutes] Unhandled error', {
        path: req.path,
        method: req.method,
        error: err?.message
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  app.get('/services/working/api/status', wrap(async (req, res) => {
    const status = await worker.getStatus();
    eventEmitter?.emit('api-working-status', status);
    res.status(200).json(status);
  }));

  // ---------------------------------------------------------------------------
  // Task submission
  // ---------------------------------------------------------------------------

  /**
   * POST /services/working/api/run
   * Queues an activity. Send `{ activity: "<name>" }` for a registered
   * activity. Raw `{ scriptPath }` is accepted only when no activity registry
   * is configured, and then only for scripts inside the activities folder.
   */
  app.post('/services/working/api/run', wrap(async (req, res) => {
    const { activity, scriptPath, data } = req.body || {};
    const completion = (status, result) => {
      eventEmitter?.emit('worker-complete', { status, result });
    };

    try {
      let taskId;
      if (activity !== undefined) {
        if (typeof activity !== 'string' || !worker.hasActivity?.(activity)) {
          return res.status(404).json({ error: 'Unknown activity' });
        }
        taskId = await worker.startActivity(activity, data, completion);
      } else {
        if (worker.hasActivityRegistry?.()) {
          return res.status(400).json({
            error: 'Raw script paths are disabled. Send { "activity": "<name>" } for a registered activity.'
          });
        }
        if (!scriptPath || typeof scriptPath !== 'string') {
          return res.status(400).json({ error: 'Bad Request: Missing scriptPath' });
        }
        taskId = await worker.start(scriptPath, data, completion);
      }

      eventEmitter?.emit('working:run-requested', {
        source: 'http',
        activity: activity || null,
        scriptPath: activity ? null : scriptPath,
        ip: req.ip,
        taskId
      });
      res.status(201).json({ status: 'OK', taskId, message: 'Task queued successfully' });
    } catch (err) {
      const message = err?.message || String(err);
      if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 500) {
        return res.status(err.statusCode).json({ error: message });
      }
      if (/queue at capacity/i.test(message)) {
        return res.status(429).json({ error: message });
      }
      if (/not found/i.test(message)) {
        return res.status(404).json({ error: message });
      }
      if (/stopped|not available|non-empty/i.test(message)) {
        return res.status(400).json({ error: message });
      }
      throw err;
    }
  }));

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  app.get('/services/working/api/stop', wrap(async (req, res) => {
    await worker.stop();
    res.status(200).json({ status: 'OK', message: 'Worker manager stopped' });
  }));

  // ---------------------------------------------------------------------------
  // History & individual tasks
  // ---------------------------------------------------------------------------

  app.get('/services/working/api/history', wrap(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 100);
    const history = await worker.getTaskHistory(limit);
    res.status(200).json(history);
  }));

  app.get('/services/working/api/task/:taskId', wrap(async (req, res) => {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ error: 'Bad Request: Missing taskId' });
    }
    const task = await worker.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: `Task "${taskId}" not found` });
    }
    res.status(200).json(task);
  }));

  // ---------------------------------------------------------------------------
  // Analytics endpoints
  // ---------------------------------------------------------------------------

  app.get('/services/working/api/stats', wrap(async (req, res) => {
    if (!analytics) {
      return res.status(503).json({ error: 'Analytics module not available' });
    }
    res.status(200).json(analytics.getStats());
  }));

  app.get('/services/working/api/analytics', wrap(async (req, res) => {
    if (!analytics) {
      return res.status(503).json({ error: 'Analytics module not available' });
    }
    const taskAnalytics = analytics.getTaskAnalytics();
    res.status(200).json({
      count: taskAnalytics.length,
      tasks: taskAnalytics
    });
  }));

  app.get(...route('/services/working/api/analytics/:scriptPath(*)'), wrap(async (req, res) => {
    if (!analytics) {
      return res.status(503).json({ error: 'Analytics module not available' });
    }
    const { scriptPath } = req.params;
    const taskAnalytics = analytics.getTaskAnalyticsByPath(scriptPath);
    if (!taskAnalytics) {
      return res.status(404).json({ error: 'Task not found', scriptPath });
    }
    res.status(200).json(taskAnalytics);
  }));

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  app.get('/services/working/api/settings', wrap(async (req, res) => {
    const settings = await worker.getSettings();
    res.status(200).json(settings);
  }));

  app.post('/services/working/api/settings', wrap(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Bad Request: Missing settings body' });
    }
    await worker.saveSettings(body);
    res.status(200).json({ status: 'OK', message: 'Settings updated' });
  }));

  // Serve static files from the swagger directory
  app.use('/services/working/api/swagger', express.static(path.join(__dirname, 'swagger')));
};
