/**
 * @fileoverview Metrics and measurement API routes for Express.js application.
 * Provides RESTful endpoints for metric collection, data aggregation,
 * and statistical analysis with time-based filtering capabilities.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers measurement routes with the Express application.
 * Sets up endpoints for metric collection and analysis operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} measuring - The measuring provider instance with metric methods
 * @return {void}
 */
module.exports = (options, eventEmitter, measuring) => {
  if (options['express-app'] && measuring) {
    const app = options['express-app'];

    /**
     * POST /services/measuring/api/add
     * Adds a new metric data point to the measurement system.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.body.metric - The metric name/identifier
     * @param {number} req.body.value - The metric value to record
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/measuring/api/add', (req, res) => {
      const {metric, value} = req.body;
      if (metric && value) {
        measuring
          .add(metric, value)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing metric or value');
      }
    });

    /**
     * GET /services/measuring/api/list/:metric/:datestart/:dateend
     * Retrieves a list of metric values within a specified date range.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.metric - The metric name to query
     * @param {string} req.params.datestart - Start date (ISO string format)
     * @param {string} req.params.dateend - End date (ISO string format)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/measuring/api/list/:metric/:datestart/:dateend',
        (req, res) => {
          measuring
            .list(req.params.metric, new Date(req.params.datestart),
                new Date(req.params.dateend))
            .then((value) => res.status(200).json(value))
            .catch((err) => res.status(500).send(err.message));
        });

    /**
     * GET /services/measuring/api/total/:metric/:datestart/:dateend
     * Calculates the total sum of metric values within a specified date range.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.metric - The metric name to aggregate
     * @param {string} req.params.datestart - Start date (ISO string format)
     * @param {string} req.params.dateend - End date (ISO string format)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/measuring/api/total/:metric/:datestart/:dateend',
        (req, res) => {
          measuring
            .total(req.params.metric, new Date(req.params.datestart),
                new Date(req.params.dateend))
            .then((value) => res.status(200).json(value))
            .catch((err) => res.status(500).send(err.message));
        });

    /**
     * GET /services/measuring/api/average/:metric/:datestart/:dateend
     * Calculates the average of metric values within a specified date range.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.metric - The metric name to average
     * @param {string} req.params.datestart - Start date (ISO string format)
     * @param {string} req.params.dateend - End date (ISO string format)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/measuring/api/average/:metric/:datestart/:dateend',
        (req, res) => {
          measuring
            .average(req.params.metric, new Date(req.params.datestart),
                new Date(req.params.dateend))
            .then((value) => res.status(200).json(value))
            .catch((err) => res.status(500).send(err.message));
        });

    /**
     * GET /services/measuring/api/status
     * Returns the operational status of the measuring service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/measuring/api/status', (req, res) => {
      eventEmitter.emit('api-measuring-status', 'measuring api running');
      res.status(200).json('measuring api running');
    });
  }
};
