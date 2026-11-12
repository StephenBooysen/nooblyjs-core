/**
 * @fileoverview Workflow orchestration API routes for Express.js application.
 * Provides RESTful endpoints for workflow definition, execution management,
 * and service status monitoring with event-driven completion callbacks.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');
const express = require('express');
const registerManagerRoutes = require('./manager');
const { sendSafeError } = require('../../shared/utils/safeError');
const { route } = require('../../shared/utils/routePattern');
const { parseLimit, parseOffset } = require('../../shared/utils/validation');
const { assertActivityReference } = require('../../working/modules/activityPath');

/**
 * Collects every step list in a workflow request body: `steps` on a
 * definition, and each definition's `steps` in an imported state snapshot.
 *
 * @param {*} body - Request body
 * @return {!Array<!Array<*>>} Step arrays found
 */
function stepListsIn(body) {
  const lists = [];
  if (!body || typeof body !== 'object') return lists;
  if (Array.isArray(body.steps)) lists.push(body.steps);
  const nested = body.workflows || body.definitions;
  const defs = Array.isArray(nested) ? nested : (nested && typeof nested === 'object' ? Object.values(nested) : []);
  for (const def of defs) {
    if (def && Array.isArray(def.steps)) lists.push(def.steps);
  }
  return lists;
}

/**
 * Feature 18: workflows defined over HTTP may only reference scripts inside the
 * activities folder (or registered activities). Absolute paths, `..` segments
 * and non-JavaScript files are refused before they can be stored and run.
 *
 * @param {Object} workflow - Workflow service (for its working service's registry)
 * @return {function(express.Request, express.Response, Function): void}
 */
function createStepGuard(workflow) {
  return (req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'PUT') return next();
    const working = workflow && workflow.workingService_;
    const registry = working && typeof working.getActivityRegistry === 'function'
      ? working.getActivityRegistry()
      : null;
    try {
      for (const steps of stepListsIn(req.body)) {
        steps.forEach((step, i) => {
          if (typeof step === 'string') {
            assertActivityReference(step, { registry, field: `step ${i + 1}` });
          }
        });
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    return next();
  };
}

/**
 * Configures and registers workflow routes with the Express application.
 * Sets up endpoints for workflow definition and execution management.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} workflow - The workflow provider instance with define/run methods
 * @param {Object} analytics - The analytics module instance for workflow analytics
 * @return {void}
 */
module.exports = (options, eventEmitter, workflow, analytics) => {
  if (options['express-app'] && workflow) {
    const app = options['express-app'];

    // Per-route authorization middleware (API key / personal access token),
    // consistent with the other service route modules (e.g. dataservice).
    // Falls back to a pass-through when no API-key auth is configured; the
    // global /services login gate still applies in that case.
    const auth = typeof options.authMiddleware === 'function'
      ? options.authMiddleware
      : (req, res, next) => next();

    app.use('/services/workflow/api', createStepGuard(workflow));

    // Manager endpoints (workflows, runs, schedules, state) - registered first
    // so the legacy wildcard routes below can never shadow them.
    registerManagerRoutes(app, eventEmitter, workflow, options.authMiddleware);

    /**
     * POST /services/workflow/api/defineworkflow
     * Defines a new workflow with a name and sequence of steps.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.body.name - The name of the workflow to define
     * @param {Array} req.body.steps - Array of workflow steps/tasks
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/workflow/api/defineworkflow', auth, async (req, res) => {
      const {name, steps} = req.body;
      if (name) {
        try {
          const workflowId = await workflow.defineWorkflow(name, steps);
          res.status(200).json({workflowId});
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter, format: 'send' });
        }
      } else {
        res.status(400).send('Bad Request: Missing workflow name');
      }
    });

    /**
     * POST /services/workflow/api/start
     * Starts execution of a defined workflow with optional input data.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.body.name - The name of the workflow to execute
     * @param {*} req.body.data - Input data for the workflow execution
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/workflow/api/start', auth, async (req, res) => {
      const {name, data} = req.body;
      if (name) {
        try {
          const workflowId = await workflow.runWorkflow(name, data, (data) => {
            eventEmitter.emit('workflow-complete', data);
          });
          res.status(200).json({workflowId});
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter, format: 'send' });
        }
      } else {
        res.status(400).send('Bad Request: Missing workflow name');
      }
    });

    /**
     * GET /services/workflow/api/status
     * Returns the operational status of the workflow service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/workflow/api/status', auth, (req, res) => {
      eventEmitter.emit('api-workflow-status', 'workflow api running');
      res.status(200).json('workflow api running');
    });

    /**
     * GET /services/workflow/api/stats
     * Retrieves overall statistics about workflow executions including counts and percentages.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/workflow/api/stats', auth, (req, res) => {
      if (!analytics) {
        return res.status(503).json({
          error: 'Analytics module not available'
        });
      }

      try {
        const stats = analytics.getStats();
        res.status(200).json(stats);
      } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve statistics' });
      }
    });

    /**
     * GET /services/workflow/api/analytics
     * Retrieves detailed analytics for all workflows ordered by last run date.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/workflow/api/analytics', auth, (req, res) => {
      if (!analytics) {
        return res.status(503).json({
          error: 'Analytics module not available'
        });
      }

      try {
        const workflowAnalytics = analytics.getWorkflowAnalytics();
        res.status(200).json({
          count: workflowAnalytics.length,
          workflows: workflowAnalytics
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve workflow analytics' });
      }
    });

    /**
     * GET /services/workflow/api/analytics/:workflowName
     * Retrieves analytics for a specific workflow by name.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/workflow/api/analytics/:workflowName(*)'), auth, (req, res) => {
      if (!analytics) {
        return res.status(503).json({
          error: 'Analytics module not available'
        });
      }

      try {
        const { workflowName } = req.params;
        const workflowAnalytics = analytics.getWorkflowAnalyticsByName(workflowName);

        if (workflowAnalytics) {
          res.status(200).json(workflowAnalytics);
        } else {
          res.status(404).json({
            error: 'Workflow not found',
            workflowName: workflowName
          });
        }
      } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve workflow analytics' });
      }
    });

    /**
     * GET /services/workflow/api/settings
     * Retrieves the settings for the workflow service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/workflow/api/settings', auth, async (req, res) => {
      try {
        const settings = await workflow.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('api-workflow-settings-error', err.message);
        res.status(500).json({ error: 'Failed to retrieve settings' });
      }
    });

    /**
     * POST /services/workflow/api/settings
     * Saves the settings for the workflow service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/workflow/api/settings', auth, async (req, res) => {
      const message = req.body;
      if (message) {
        try {
          await workflow.saveSettings(message);
          res.status(200).send('OK');
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter, format: 'send' });
        }
      } else {
        res.status(400).send('Bad Request: Missing settings');
      }
    });

    // ========== Workflow Definition Endpoints ==========

    /**
     * GET /services/workflow/api/definitions
     * Retrieves all workflow definitions.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/workflow/api/definitions', auth, (req, res) => {
      try {
        if (!workflow.definitionContainer) {
          return res.status(503).json({ error: 'Definition container not available' });
        }

        const definitions = workflow.definitionContainer.getAll();
        res.status(200).json({
          count: definitions.length,
          definitions
        });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/workflow/api/definitions/:workflowName
     * Retrieves a specific workflow definition.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/workflow/api/definitions/:workflowName(*)'), auth, (req, res) => {
      try {
        if (!workflow.definitionContainer) {
          return res.status(503).json({ error: 'Definition container not available' });
        }

        const { workflowName } = req.params;
        const definition = workflow.definitionContainer.get(workflowName);

        if (!definition) {
          return res.status(404).json({
            error: 'Workflow definition not found',
            workflowName
          });
        }

        res.status(200).json(definition);
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * PUT /services/workflow/api/definitions/:workflowName
     * Updates a workflow definition's steps.
     *
     * @param {express.Request} req - Express request object
     * @param {Array<string>} req.body.steps - New steps array
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.put(...route('/services/workflow/api/definitions/:workflowName(*)'), auth, async (req, res) => {
      try {
        if (!workflow.definitionContainer) {
          return res.status(503).json({ error: 'Definition container not available' });
        }

        const { workflowName } = req.params;
        const { steps, metadata } = req.body;

        if (!workflow.definitionContainer.exists(workflowName)) {
          return res.status(404).json({
            error: 'Workflow definition not found',
            workflowName
          });
        }

        let definition;
        if (steps && Array.isArray(steps) && steps.length > 0) {
          definition = workflow.definitionContainer.updateSteps(workflowName, steps);
          // Also update in working workflows map
          workflow.workflows.set(workflowName, steps);
        }

        if (metadata && typeof metadata === 'object') {
          definition = workflow.definitionContainer.updateMetadata(workflowName, metadata);
        }

        res.status(200).json(definition || workflow.definitionContainer.get(workflowName));
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/workflow/api/definitions/:workflowName
     * Deletes a workflow definition.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(...route('/services/workflow/api/definitions/:workflowName(*)'), auth, async (req, res) => {
      try {
        if (!workflow.definitionContainer) {
          return res.status(503).json({ error: 'Definition container not available' });
        }

        const { workflowName } = req.params;

        if (!workflow.definitionContainer.exists(workflowName)) {
          return res.status(404).json({
            error: 'Workflow definition not found',
            workflowName
          });
        }

        if (typeof workflow.deleteWorkflow === 'function') {
          // Also removes the workflow's schedules and history.
          await workflow.deleteWorkflow(workflowName);
        } else {
          workflow.definitionContainer.delete(workflowName);
          workflow.workflows.delete(workflowName);
        }

        res.status(200).json({
          success: true,
          message: `Workflow '${workflowName}' deleted`,
          workflowName
        });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    // ========== Workflow Execution Endpoints ==========
    // The more specific /stats and /execution/:id routes are registered before
    // the greedy /executions/:workflowName(*) list route, which would capture them.

    /**
     * GET /services/workflow/api/executions/:workflowName/:executionId
     * Retrieves details of a specific workflow execution.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/workflow/api/executions/:workflowName(*)/execution/:executionId(*)'), auth, (req, res) => {
      try {
        if (!workflow.executionContainer) {
          return res.status(503).json({ error: 'Execution container not available' });
        }

        const { workflowName, executionId } = req.params;

        const execution = workflow.executionContainer.getExecution(workflowName, executionId);

        if (!execution) {
          return res.status(404).json({
            error: 'Execution not found',
            workflowName,
            executionId
          });
        }

        res.status(200).json(execution);
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/workflow/api/executions/:workflowName/stats
     * Retrieves execution statistics for a workflow.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/workflow/api/executions/:workflowName(*)/stats'), auth, (req, res) => {
      try {
        if (!workflow.executionContainer) {
          return res.status(503).json({ error: 'Execution container not available' });
        }

        const { workflowName } = req.params;

        const stats = workflow.executionContainer.getStats(workflowName);

        res.status(200).json({
          workflowName,
          ...stats
        });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * GET /services/workflow/api/executions/:workflowName
     * Retrieves execution history for a specific workflow.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.query.status - Filter by status (completed, running, error)
     * @param {number} req.query.limit - Max results (default: 50)
     * @param {number} req.query.offset - Pagination offset (default: 0)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(...route('/services/workflow/api/executions/:workflowName(*)'), auth, (req, res) => {
      try {
        if (!workflow.executionContainer) {
          return res.status(503).json({ error: 'Execution container not available' });
        }

        const { workflowName } = req.params;
        const { status, limit, offset } = req.query;

        const options = {
          status: status || undefined,
          limit: parseLimit(limit, { defaultValue: 50 }),
          offset: parseOffset(offset)
        };

        const result = workflow.executionContainer.getExecutions(workflowName, options);

        res.status(200).json({
          workflowName,
          ...result
        });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    /**
     * DELETE /services/workflow/api/executions/:workflowName
     * Deletes executions for a workflow based on criteria.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.query.older_than - ISO timestamp, delete older
     * @param {string} req.query.status - Delete only this status
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(...route('/services/workflow/api/executions/:workflowName(*)'), auth, (req, res) => {
      try {
        if (!workflow.executionContainer) {
          return res.status(503).json({ error: 'Execution container not available' });
        }

        const { workflowName } = req.params;
        const { older_than, status } = req.query;

        const options = {
          older_than: older_than || undefined,
          status: status || undefined
        };

        const deleted = workflow.executionContainer.deleteExecutions(workflowName, options);

        res.status(200).json({
          success: true,
          message: `Deleted ${deleted} execution(s)`,
          workflowName,
          deleted
        });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    });

    // Serve static files from the views directory for caching service
    app.use('/services/workflow/api/swagger', express.static(path.join(__dirname,'swagger')));

  }
};
