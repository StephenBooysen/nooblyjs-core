/**
 * @fileoverview Workflow manager API routes.
 * REST endpoints behind the workflow manager UI: grouped workflow listing with
 * schedule status and last-run data, execution history (across workflows and
 * per workflow), schedule management, cron preview and state export/import.
 *
 * All endpoints are mounted under `/services/workflow/api`. Workflows are
 * identified by name; names are URL-encoded in paths (a name containing `/`
 * is sent as `%2F`).
 *
 * Errors carry the HTTP status the service attached (`err.statusCode`): 400
 * for invalid input, 404 for unknown workflows/schedules/executions, 409 for
 * conflicts, 503 when no working service is available. Anything else is 500.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.1.0
 */

'use strict';

/** @const {string} Mount point for every manager endpoint. */
const BASE = '/services/workflow/api';

/**
 * Parses a query value as a non-negative integer.
 * @param {*} value - Raw query value
 * @param {number} fallback - Value when missing or invalid
 * @param {number} [max] - Upper bound
 * @return {number} The parsed integer
 * @private
 */
function toInt(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return max !== undefined ? Math.min(n, max) : n;
}

/**
 * Parses a query value as a boolean, or undefined when absent.
 * @param {*} value - Raw query value
 * @return {boolean|undefined} The parsed flag
 * @private
 */
function toBool(value) {
  if (value === undefined || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
}

/**
 * Registers the workflow manager routes.
 *
 * @param {express.Application} app - Express application
 * @param {EventEmitter} eventEmitter - Global event emitter
 * @param {Object} workflow - Workflow service (memory provider)
 * @param {function=} authMiddleware - Per-route API-key/token authorization
 *   middleware. When omitted, a pass-through is used (the global /services
 *   login gate still applies), matching the other service route modules.
 * @return {void}
 */
module.exports = (app, eventEmitter, workflow, authMiddleware) => {
  // The remote API provider has no in-memory manager to serve.
  if (!workflow || typeof workflow.listWorkflows !== 'function') return;

  // Enforce access control on every manager endpoint. These routes expose
  // destructive operations (delete workflows/schedules/executions, import full
  // state), so they must carry the same per-route authorization as the rest of
  // the framework rather than relying on the global gate alone.
  const auth = typeof authMiddleware === 'function'
    ? authMiddleware
    : (req, res, next) => next();

  /**
   * Wraps a handler so thrown errors become JSON responses with the status
   * the service attached. Returns a `[auth, handler]` middleware chain so the
   * authorization middleware runs before the handler on every route.
   * @param {string} operation - Name used in logs
   * @param {function(express.Request, express.Response): *} fn - Handler
   * @return {Array<function(express.Request, express.Response, function=): (void|Promise<void>)>}
   */
  const handle = (operation, fn) => [auth, async (req, res) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) res.status(200).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      if (status >= 500) {
        workflow.logger?.error(`[WorkflowManagerRoutes] ${operation} failed`, {
          error: err.message,
          path: req.path
        });
        eventEmitter?.emit('api-workflow-error', { operation, error: err.message });
      }
      // Client errors (4xx) carry a service-crafted, user-safe message
      // (validation/conflict/not-found). Server errors (5xx) may embed internal
      // details, so return a generic message and keep the specifics in the logs.
      if (!res.headersSent) {
        const clientMessage = status >= 500 ? 'Internal Server Error' : err.message;
        res.status(status).json({ error: clientMessage });
      }
    }
  }];

  // ---------------------------------------------------------------------------
  // Workflows
  // ---------------------------------------------------------------------------

  /**
   * GET /services/workflow/api/workflows
   * Lists workflows with schedule status (active / inactive / null).
   * Query: starred=true, tags=a,b, group, search
   */
  app.get(`${BASE}/workflows`, handle('listWorkflows', req => workflow.listWorkflows({
    starred: toBool(req.query.starred) === true,
    tags: req.query.tags ? String(req.query.tags).split(',').map(t => t.trim()).filter(Boolean) : undefined,
    group: req.query.group || undefined,
    search: req.query.search || undefined
  })));

  /** GET /services/workflow/api/workflows/groups - distinct group names. */
  app.get(`${BASE}/workflows/groups`, handle('listGroups', () => workflow.listGroups()));

  /**
   * GET /services/workflow/api/workflows/last-runs
   * The most recent run of each workflow, keyed by workflow name.
   */
  app.get(`${BASE}/workflows/last-runs`, handle('getLastRuns', () => workflow.getLastRuns()));

  /** POST /services/workflow/api/workflows - create a workflow. */
  app.post(`${BASE}/workflows`, handle('createWorkflow', async (req, res) => {
    const created = await workflow.createWorkflow(req.body || {});
    res.status(201).json(created);
  }));

  /**
   * POST /services/workflow/api/workflows/import
   * Imports an exported workflow. Query: overwrite=true to replace an existing one.
   */
  app.post(`${BASE}/workflows/import`, handle('importWorkflow', async (req, res) => {
    const imported = await workflow.importWorkflow(req.body || {}, {
      overwrite: toBool(req.query.overwrite) === true
    });
    res.status(201).json(imported);
  }));

  /** GET /services/workflow/api/workflows/:name - one workflow. */
  app.get(`${BASE}/workflows/:name`, handle('getWorkflow', req => workflow.getWorkflow(req.params.name)));

  /** PUT /services/workflow/api/workflows/:name - update (and optionally rename) a workflow. */
  app.put(`${BASE}/workflows/:name`, handle('updateWorkflow',
    req => workflow.updateWorkflow(req.params.name, req.body || {})));

  /** DELETE /services/workflow/api/workflows/:name - delete a workflow, its schedules and history. */
  app.delete(`${BASE}/workflows/:name`, handle('deleteWorkflow',
    req => workflow.deleteWorkflow(req.params.name)));

  /** POST /services/workflow/api/workflows/:name/star - body `{ starred: boolean }`. */
  app.post(`${BASE}/workflows/:name/star`, handle('setStarred', (req) => {
    const starred = req.body && req.body.starred !== undefined
      ? !!req.body.starred
      : !workflow.getWorkflow(req.params.name).starred;
    return workflow.setStarred(req.params.name, starred);
  }));

  /** POST /services/workflow/api/workflows/:name/view - record that a workflow was opened. */
  app.post(`${BASE}/workflows/:name/view`, handle('markViewed', req => workflow.markViewed(req.params.name)));

  /** GET /services/workflow/api/workflows/:name/export - portable definition. */
  app.get(`${BASE}/workflows/:name/export`, handle('exportWorkflow', (req, res) => {
    const exported = workflow.exportWorkflow(req.params.name);
    const fileName = `${req.params.name.replace(/[^a-zA-Z0-9._-]+/g, '_')}.workflow.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return exported;
  }));

  /**
   * POST /services/workflow/api/workflows/:name/execute
   * Body: `{ input?: Object, wait?: boolean }`. Without `wait` the run starts
   * in the background and the response is 202 `{ executionId }`; with
   * `wait: true` the response is the final execution record.
   */
  app.post(`${BASE}/workflows/:name/execute`, handle('executeWorkflow', async (req, res) => {
    const body = req.body || {};
    const input = body.input !== undefined ? body.input : {};
    if (body.wait === true) {
      return workflow.executeWorkflow(req.params.name, input, { trigger: 'manual' });
    }
    const { executionId } = workflow.startExecution(req.params.name, input, { trigger: 'manual' });
    res.status(202).json({ executionId, workflowName: req.params.name, status: 'running' });
    return undefined;
  }));

  /**
   * GET /services/workflow/api/workflows/:name/executions
   * One workflow's history. Query: days (default 30, `all` = all retained),
   * limit (default 200, max 1000), status (success | failed | running).
   */
  app.get(`${BASE}/workflows/:name/executions`, handle('listWorkflowExecutions', (req) => {
    const rawDays = String(req.query.days || '').toLowerCase();
    const days = rawDays === 'all' ? 0 : toInt(req.query.days, 30);
    const status = ['success', 'failed', 'running'].includes(req.query.status) ? req.query.status : undefined;
    return workflow.listWorkflowExecutions(req.params.name, {
      days,
      limit: toInt(req.query.limit, 200, 1000) || 200,
      status
    });
  }));

  /** GET /services/workflow/api/workflows/:name/schedules - the workflow's schedules. */
  app.get(`${BASE}/workflows/:name/schedules`, handle('listWorkflowSchedules', (req) => {
    workflow.getWorkflow(req.params.name);
    return workflow.listSchedules({ workflowName: req.params.name });
  }));

  // ---------------------------------------------------------------------------
  // Runs (execution history across workflows)
  // ---------------------------------------------------------------------------

  /**
   * GET /services/workflow/api/runs
   * Execution summaries, newest first. Query: workflowName, status, from, to,
   * scheduleId, limit (default 100, max 1000), offset.
   */
  app.get(`${BASE}/runs`, handle('listExecutions', req => workflow.listExecutions({
    workflowName: req.query.workflowName || undefined,
    status: req.query.status || undefined,
    from: req.query.from || undefined,
    to: req.query.to || undefined,
    scheduleId: req.query.scheduleId || undefined,
    limit: toInt(req.query.limit, 100, 1000) || 100,
    offset: toInt(req.query.offset, 0)
  })));

  /** GET /services/workflow/api/runs/stats - outcome statistics. Query: workflowName, from, to, days. */
  app.get(`${BASE}/runs/stats`, handle('getExecutionStats', (req) => {
    const days = toInt(req.query.days, 0);
    const from = req.query.from
      || (days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : undefined);
    return workflow.getExecutionStats({
      workflowName: req.query.workflowName || undefined,
      from,
      to: req.query.to || undefined
    });
  }));

  /** GET /services/workflow/api/runs/running - executions in flight. */
  app.get(`${BASE}/runs/running`, handle('listRunning',
    () => workflow.listExecutions({ status: 'running', limit: 1000 })));

  /** POST /services/workflow/api/runs/clear - body `{ olderThanDays?, workflowName? }`. */
  app.post(`${BASE}/runs/clear`, handle('clearExecutions', (req) => {
    const body = req.body || {};
    const deletedCount = workflow.clearExecutions({
      olderThanDays: body.olderThanDays,
      workflowName: body.workflowName || undefined
    });
    return { deletedCount };
  }));

  /** GET /services/workflow/api/runs/:id - a full execution record. */
  app.get(`${BASE}/runs/:id`, handle('getExecution', (req) => {
    const execution = workflow.getExecution(req.params.id);
    if (!execution) {
      const err = new Error(`Execution '${req.params.id}' not found`);
      err.statusCode = 404;
      throw err;
    }
    return execution;
  }));

  /** POST /services/workflow/api/runs/:id/cancel - stop a run before its next step. */
  app.post(`${BASE}/runs/:id/cancel`, handle('cancelExecution', req => workflow.cancelExecution(req.params.id)));

  /** DELETE /services/workflow/api/runs/:id - delete a finished execution record. */
  app.delete(`${BASE}/runs/:id`, handle('deleteExecution', (req) => {
    workflow.deleteExecution(req.params.id);
    return { deleted: true, executionId: req.params.id };
  }));

  // ---------------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------------

  /** GET /services/workflow/api/schedules - query: workflowName, enabled=true|false. */
  app.get(`${BASE}/schedules`, handle('listSchedules', req => workflow.listSchedules({
    workflowName: req.query.workflowName || undefined,
    enabled: toBool(req.query.enabled)
  })));

  /** GET /services/workflow/api/schedules/stats - summary counts. */
  app.get(`${BASE}/schedules/stats`, handle('getScheduleStats', () => workflow.getScheduleStats()));

  /**
   * POST /services/workflow/api/schedules
   * Body: `{ workflowName, name?, cronExpression | interval, description?, input?, enabled? }`.
   */
  app.post(`${BASE}/schedules`, handle('createSchedule', (req, res) => {
    res.status(201).json(workflow.createSchedule(req.body || {}));
  }));

  /** GET /services/workflow/api/schedules/:id - one schedule. */
  app.get(`${BASE}/schedules/:id`, handle('getSchedule', req => workflow.getSchedule(req.params.id)));

  /** PUT /services/workflow/api/schedules/:id - update a schedule. */
  app.put(`${BASE}/schedules/:id`, handle('updateSchedule',
    req => workflow.updateSchedule(req.params.id, req.body || {})));

  /** DELETE /services/workflow/api/schedules/:id - delete a schedule. */
  app.delete(`${BASE}/schedules/:id`, handle('deleteSchedule', (req) => {
    workflow.deleteSchedule(req.params.id);
    return { deleted: true, scheduleId: req.params.id };
  }));

  /** POST /services/workflow/api/schedules/:id/toggle - body `{ enabled? }`; flips when omitted. */
  app.post(`${BASE}/schedules/:id/toggle`, handle('toggleSchedule', (req) => {
    if (req.body && typeof req.body.enabled === 'boolean') {
      return workflow.setScheduleEnabled(req.params.id, req.body.enabled);
    }
    return workflow.toggleSchedule(req.params.id);
  }));

  /** POST /services/workflow/api/schedules/:id/run-now - run immediately (202). */
  app.post(`${BASE}/schedules/:id/run-now`, handle('runScheduleNow', (req, res) => {
    const { done } = workflow.runScheduleNow(req.params.id);
    done.catch(() => { /* outcome is recorded on the schedule and execution */ });
    res.status(202).json({ scheduleId: req.params.id, status: 'running' });
  }));

  // ---------------------------------------------------------------------------
  // Cron preview and state
  // ---------------------------------------------------------------------------

  /** GET /services/workflow/api/cron/preview?expression=...&count=5 - validate and preview a cron. */
  app.get(`${BASE}/cron/preview`, handle('previewCron',
    req => workflow.previewCron(String(req.query.expression || ''), toInt(req.query.count, 5, 20))));

  /**
   * GET /services/workflow/api/state - the full in-memory state snapshot.
   * Query: includeExecutions=false to omit history.
   */
  app.get(`${BASE}/state`, handle('exportState', req => workflow.exportState({
    includeExecutions: toBool(req.query.includeExecutions) !== false
  })));

  /** PUT /services/workflow/api/state - import a snapshot (merges by name / id). */
  app.put(`${BASE}/state`, handle('importState', req => workflow.importState(req.body || {})));
};
