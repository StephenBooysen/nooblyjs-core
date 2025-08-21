/**
 * @fileoverview Worker management API routes for Express.js application.
 * Provides RESTful endpoints for background task execution, worker lifecycle
 * management, and service status monitoring with event-driven callbacks.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers worker routes with the Express application.
 * Sets up endpoints for background task execution and worker management.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} worker - The worker provider instance with start/stop methods
 * @return {void}
 */
module.exports = (options, eventEmitter, worker) => {
  if (options['express-app'] && worker) {
    const app = options['express-app'];

    /**
     * POST /services/working/api/run
     * Starts a background worker task with completion callback.
     *
     * @param {express.Request} req - Express request object
     * @param {*} req.body.task - The task to execute in the background
     * @param {*} req.body.data - Optional data for the task execution
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/working/api/run', (req, res) => {
      const { task } = req.body;
      if (task) {
        worker
          .start(task, (data) => {
            eventEmitter.emit('worker-complete', data);
          })
          .then((result) => res.status(200).json(result))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing task');
      }
    });

    /**
     * GET /services/working/api/stop
     * Stops the currently running background worker.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/working/api/stop', (req, res) => {
      worker
        .stop()
        .then((result) => res.status(200).json(result))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/working/api/status
     * Returns the operational status of the working service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/working/api/status', (req, res) => {
      eventEmitter.emit('api-working-status', 'working api running');
      res.status(200).json('working api running');
    });
  }
};
