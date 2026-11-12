/**
 * @fileoverview Schedule manager API routes.
 * REST endpoints behind the schedule manager UI: task listing with each
 * task's own outcome bookkeeping and next run, create / edit / pause /
 * run-now / delete, recent run history, and cron preview.
 *
 * Mounted under `/services/scheduling/api`. Tasks are identified by name;
 * names are URL-encoded in paths.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.1.0
 */

'use strict';

const { parseCron, nextMatch } = require('../providers/cronExpression');
const { assertActivityReference } = require('../../working/modules/activityPath');

/**
 * Explains why a cron expression is rejected.
 * @param {string} expression - Candidate expression
 * @return {?string} The reason, or null when it is valid and fires
 * @private
 */
function cronProblem(expression) {
  try {
    parseCron(expression);
  } catch (err) {
    return `Invalid cron expression "${expression}": ${err.message}`;
  }
  return nextMatch(expression) ? null : `Cron expression "${expression}" never fires`;
}

/** @const {string} Mount point for every manager endpoint. */
const BASE = '/services/scheduling/api';

/**
 * Parses a positive integer query value.
 * @param {*} value - Raw value
 * @param {number} fallback - Value when missing or invalid
 * @param {number} max - Upper bound
 * @return {number} The parsed integer
 * @private
 */
function toInt(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

/**
 * Creates an error carrying an HTTP status.
 * @param {string} message - Message
 * @param {number} statusCode - HTTP status
 * @return {!Error} The error
 * @private
 */
function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Registers the schedule manager routes.
 *
 * @param {express.Application} app - Express application
 * @param {EventEmitter} eventEmitter - Global event emitter
 * @param {!Object} scheduler - Scheduler provider
 * @return {void}
 */
module.exports = (app, eventEmitter, scheduler) => {
  /**
   * Feature 18: a schedule created over HTTP may only name a script inside the
   * activities folder (or a registered activity).
   * @param {string} scriptPath - Submitted script path
   * @return {string} The validated reference
   */
  const checkScript = (scriptPath) => {
    const worker = scheduler && scheduler.worker_;
    try {
      return assertActivityReference(scriptPath, {
        registry: worker && typeof worker.getActivityRegistry === 'function' ? worker.getActivityRegistry() : null
      });
    } catch (err) {
      throw httpError(err.message, 400);
    }
  };

  if (!app || !scheduler || typeof scheduler.pause !== 'function') return;

  /**
   * Wraps a handler so thrown errors become JSON responses. Provider
   * validation errors ("Invalid ...", "Give either ...") answer 400.
   * @param {string} operation - Name used in logs
   * @param {function(express.Request, express.Response): *} fn - Handler
   * @return {function(express.Request, express.Response): Promise<void>}
   */
  const handle = (operation, fn) => async (req, res) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) res.status(200).json(result);
    } catch (err) {
      let status = err.statusCode;
      if (!status) status = /^(Invalid|Give either)/.test(err.message || '') ? 400 : 500;
      if (status >= 500) {
        scheduler.logger?.error?.(`[ScheduleManagerRoutes] ${operation} failed`, {
          error: err.message,
          path: req.path
        });
        eventEmitter?.emit('api-scheduling-error', { operation, error: err.message });
      }
      // Client errors (4xx) carry a service-crafted, user-safe message. Server
      // errors (5xx) may embed internal details, so return a generic message
      // and keep the specifics in the logs.
      if (!res.headersSent) {
        const clientMessage = status >= 500 ? 'Internal Server Error' : err.message;
        res.status(status).json({ error: clientMessage });
      }
    }
  };

  /**
   * Loads a task summary or throws 404.
   * @param {string} name - Task name
   * @return {Promise<!Object>} The summary
   */
  const requireTask = async (name) => {
    const task = await scheduler.getSchedule(name);
    if (!task) throw httpError(`Schedule "${name}" not found`, 404);
    return task;
  };

  /**
   * Validates the cadence in a create/update body.
   * @param {!Object} body - Request body
   * @param {boolean} required - Whether a cadence must be present
   * @return {{cron: ?string, intervalSeconds: ?number}}
   */
  const cadenceOf = (body, required) => {
    const cron = typeof (body.cronExpression ?? body.cron) === 'string'
      ? String(body.cronExpression ?? body.cron).trim() : '';
    const hasInterval = body.intervalSeconds !== undefined && body.intervalSeconds !== null && body.intervalSeconds !== '';
    if (!cron && !hasInterval) {
      if (required) throw httpError('Either cronExpression or intervalSeconds is required', 400);
      return { cron: null, intervalSeconds: null };
    }
    if (cron && hasInterval) throw httpError('Give either cronExpression or intervalSeconds, not both', 400);
    if (cron) {
      const problem = cronProblem(cron);
      if (problem) throw httpError(problem, 400);
      return { cron, intervalSeconds: null };
    }
    const seconds = Number(body.intervalSeconds);
    if (!Number.isFinite(seconds) || seconds < 1) throw httpError('intervalSeconds must be a number >= 1', 400);
    return { cron: null, intervalSeconds: seconds };
  };

  /**
   * GET /services/scheduling/api/tasks
   * Every task with its plan and own outcome, soonest next run first.
   */
  app.get(`${BASE}/tasks`, handle('listTasks', async () => {
    const tasks = await scheduler.listSchedules();
    return tasks.sort((a, b) => {
      const at = a.nextRun ? Date.parse(a.nextRun) : Infinity;
      const bt = b.nextRun ? Date.parse(b.nextRun) : Infinity;
      return at - bt || String(a.name).localeCompare(String(b.name));
    });
  }));

  /** GET /services/scheduling/api/tasks/stats - summary counts. */
  app.get(`${BASE}/tasks/stats`, handle('getStats', () => scheduler.getStats()));

  /**
   * POST /services/scheduling/api/tasks
   * Body: `{ name, scriptPath, cronExpression | intervalSeconds, data?, description?, group?, enabled? }`.
   * Interval tasks created here first run one interval after creation.
   */
  app.post(`${BASE}/tasks`, handle('createTask', async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const scriptPath = typeof body.scriptPath === 'string' ? body.scriptPath.trim() : '';
    if (!name) throw httpError('name is required', 400);
    if (!scriptPath) throw httpError('scriptPath is required', 400);
    checkScript(scriptPath);
    if (await scheduler.getSchedule(name)) throw httpError(`Schedule "${name}" already exists`, 409);
    const { cron, intervalSeconds } = cadenceOf(body, true);
    const data = body.data === undefined ? null : body.data;
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
    const group = typeof body.group === 'string' && body.group.trim() ? body.group.trim() : null;

    if (cron) {
      await scheduler.startCron({ scriptPath, data, name, description, group }, cron, name);
      if (body.enabled === false) await scheduler.pause(name);
    } else {
      await scheduler.start(name, scriptPath, data, intervalSeconds, undefined, {
        paused: body.enabled === false,
        runImmediately: false,
        description,
        group
      });
    }
    res.status(201).json(await scheduler.getSchedule(name));
  }));

  /** GET /services/scheduling/api/tasks/:name - one task. */
  app.get(`${BASE}/tasks/:name`, handle('getTask', req => requireTask(req.params.name)));

  /**
   * PUT /services/scheduling/api/tasks/:name
   * Body: any of `{ cronExpression | intervalSeconds, scriptPath, data, description, group, enabled }`.
   */
  app.put(`${BASE}/tasks/:name`, handle('updateTask', async (req) => {
    const name = req.params.name;
    await requireTask(name);
    const body = req.body || {};
    const { cron, intervalSeconds } = cadenceOf(body, false);
    const changes = {};
    if (cron) changes.cron = cron;
    if (intervalSeconds) changes.intervalSeconds = intervalSeconds;
    if (body.scriptPath !== undefined) changes.scriptPath = checkScript(String(body.scriptPath));
    if (body.data !== undefined) changes.data = body.data;
    if (body.description !== undefined) changes.description = body.description ? String(body.description).trim() : null;
    if (body.group !== undefined) changes.group = body.group ? String(body.group).trim() : null;
    await scheduler.update(name, changes);
    if (body.enabled === true) await scheduler.resume(name);
    if (body.enabled === false) await scheduler.pause(name);
    return scheduler.getSchedule(name);
  }));

  /** DELETE /services/scheduling/api/tasks/:name - stop and remove a task. */
  app.delete(`${BASE}/tasks/:name`, handle('deleteTask', async (req) => {
    await requireTask(req.params.name);
    await scheduler.cancel(req.params.name);
    return { deleted: true, name: req.params.name };
  }));

  /** POST /services/scheduling/api/tasks/:name/toggle - body `{ enabled? }`; flips when omitted. */
  app.post(`${BASE}/tasks/:name/toggle`, handle('toggleTask', async (req) => {
    const task = await requireTask(req.params.name);
    const enable = req.body && typeof req.body.enabled === 'boolean' ? req.body.enabled : !task.enabled;
    if (enable) await scheduler.resume(req.params.name);
    else await scheduler.pause(req.params.name);
    return scheduler.getSchedule(req.params.name);
  }));

  /** POST /services/scheduling/api/tasks/:name/run-now - run once now (202). */
  app.post(`${BASE}/tasks/:name/run-now`, handle('runTaskNow', async (req, res) => {
    const task = await requireTask(req.params.name);
    if (task.running) throw httpError(`Schedule "${task.name}" already has a run in flight`, 409);
    await scheduler.runNow(req.params.name);
    res.status(202).json({ name: task.name, status: 'running' });
  }));

  /**
   * GET /services/scheduling/api/runs
   * Recent runs, newest first. Query: taskName, status (success | failed |
   * running | skipped), limit (default 100, max 1000).
   */
  app.get(`${BASE}/runs`, handle('listRuns', req => scheduler.listRuns({
    taskName: req.query.taskName || undefined,
    status: req.query.status || undefined,
    limit: toInt(req.query.limit, 100, 1000)
  })));

  /** GET /services/scheduling/api/runs/:id - one run with its result. */
  app.get(`${BASE}/runs/:id`, handle('getRun', async (req) => {
    const run = await scheduler.getRun(req.params.id);
    if (!run) throw httpError(`Run "${req.params.id}" not found`, 404);
    return run;
  }));

  /** GET /services/scheduling/api/cron/preview?expression=...&count=5 - validate and preview. */
  app.get(`${BASE}/cron/preview`, handle('previewCron', (req) => {
    const expression = String(req.query.expression || '').trim();
    const count = toInt(req.query.count, 5, 20);
    const problem = cronProblem(expression);
    if (problem) return { valid: false, error: problem, nextRuns: [] };
    const nextRuns = [];
    let next = nextMatch(expression);
    while (next && nextRuns.length < count) {
      nextRuns.push(next.toISOString());
      next = nextMatch(expression, next);
    }
    return { valid: true, error: null, nextRuns };
  }));
};
