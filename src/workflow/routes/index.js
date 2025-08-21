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

/**
 * Configures and registers workflow routes with the Express application.
 * Sets up endpoints for workflow definition and execution management.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} workflow - The workflow provider instance with define/run methods
 * @return {void}
 */
module.exports = (options, eventEmitter, workflow) => {
  if (options['express-app'] && workflow) {
    const app = options['express-app'];

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
    app.post('/services/workflow/api/defineworkflow', (req, res) => {
      const {name, steps} = req.body;
      if (name) {
        workflow
          .defineWorkflow(name, steps)
          .then((workflowId) => res.status(200).json({workflowId}))
          .catch((err) => res.status(500).send(err.message));
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
    app.post('/services/workflow/api/start', (req, res) => {
      const {name, data} = req.body;
      if (name) {
        workflow
          .runWorkflow(name, data, (data) => {
            eventEmitter.emit('workflow-complete', data);
          })
          .then((workflowId) => res.status(200).json({workflowId}))
          .catch((err) => res.status(500).send(err.message));
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
    app.get('/services/workflow/api/status', (req, res) => {
      eventEmitter.emit('api-workflow-status', 'workflow api running');
      res.status(200).json('workflow api running');
    });
  }
};
