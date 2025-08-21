/**
 * @fileoverview Task queue API routes for Express.js application.
 * Provides RESTful endpoints for FIFO task queue operations including
 * enqueue, dequeue, size monitoring, and service status reporting.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers queueing routes with the Express application.
 * Sets up endpoints for task queue management operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} queue - The queue provider instance with enqueue/dequeue methods
 * @return {void}
 */
module.exports = (options, eventEmitter, queue) => {
  if (options['express-app'] && queue) {
    const app = options['express-app'];

    /**
     * POST /services/queueing/api/enqueue
     * Adds a task to the end of the queue for processing.
     *
     * @param {express.Request} req - Express request object
     * @param {*} req.body.task - The task object to add to the queue
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/queueing/api/enqueue', (req, res) => {
      const {task} = req.body;
      if (task) {
        queue
          .enqueue(task)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing task');
      }
    });

    /**
     * GET /services/queueing/api/dequeue
     * Removes and returns the next task from the front of the queue.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/api/dequeue', (req, res) => {
      queue
        .dequeue()
        .then((task) => res.status(200).json(task))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/queueing/api/size
     * Returns the current number of tasks in the queue.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/api/size', (req, res) => {
      queue
        .size()
        .then((size) => res.status(200).json(size))
        .catch((err) => res.status(500).send(err.message));
    });

    /**
     * GET /services/queueing/api/status
     * Returns the operational status of the queueing service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/api/status', (req, res) => {
      eventEmitter.emit('api-queueing-status', 'queueing api running');
      res.status(200).json('queueing api running');
    });
  }
};
