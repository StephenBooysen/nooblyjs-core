/**
 * @fileoverview Task scheduling API routes for Express.js application.
 * Provides RESTful endpoints for cron-based task scheduling including
 * schedule creation, cancellation, and service status monitoring.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers scheduling routes with the Express application.
 * Sets up endpoints for cron-based task scheduling operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} scheduler - The scheduler provider instance with start/cancel methods
 * @return {void}
 */
module.exports = (options, eventEmitter, scheduler) => {
  if (options['express-app'] && scheduler) {
    const app = options['express-app'];

    /**
     * POST /services/scheduling/api/schedule
     * Schedules a task to run based on a cron expression.
     *
     * @param {express.Request} req - Express request object
     * @param {*} req.body.task - The task to schedule for execution
     * @param {string} req.body.cron - The cron expression defining the schedule
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/scheduling/api/schedule', (req, res) => {
      const {task, cron} = req.body;
      if (task && cron) {
        scheduler
          .start(task, cron)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing task or cron expression');
      }
    });

    /**
     * DELETE /services/scheduling/api/cancel/:taskId
     * Cancels a scheduled task by its identifier.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.taskId - The ID of the scheduled task to cancel
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete('/services/scheduling/api/cancel/:taskId', (req, res) => {
      const taskId = req.params.taskId;
      scheduler
        .cancel(taskId)
        .then(() => res.status(200).send('OK'))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/scheduling/api/status
     * Returns the operational status of the scheduling service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/scheduling/api/status', (req, res) => {
      eventEmitter.emit('api-scheduling-status', 'scheduling api running');
      res.status(200).json('scheduling api running');
    });
  }
};
