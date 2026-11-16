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

const { sendSafeError } = require('../../shared/utils/safeError');
const { ClientError } = require('../../shared/utils/httpErrors');
const { capLimit } = require('../../shared/utils/validation');

/**
 * Configures and registers measurement routes with the Express application.
 * Sets up endpoints for metric collection and analysis operations.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} measuring - The measuring provider instance with metric methods
 * @param {Object} analytics - Analytics module for measurement insights
 * @return {void}
 */
/**
 * Parses a date path segment. An unparseable value is refused with 400 rather
 * than being treated as an empty range (which would report 0 silently).
 *
 * @param {string} value Date text from the URL
 * @return {Date} The parsed date
 * @throws {ClientError} 400 when the value is not a date
 */
function parseDateSegment(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ClientError(400, `Invalid date: ${value}. Use an ISO date such as 2026-01-31`);
  }
  return date;
}

module.exports = (options, eventEmitter, measuring, analytics) => {
  if (options['express-app'] && measuring) {
    const app = options['express-app'];

    // Enforce authentication on every measuring API endpoint. Mounting the
    // shared API-key/session middleware on the /api prefix protects all routes
    // below regardless of how each handler is registered. Falls back to a
    // pass-through only when no auth is configured.
    const requireApiAuth = options.authMiddleware || ((req, res, next) => next());
    app.use('/services/measuring/api', requireApiAuth);

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
    app.post('/services/measuring/api/add', async (req, res) => {
      const { metric, value } = req.body || {};

      if (typeof metric !== 'string' || metric.trim() === '') {
        return res.status(400).json({ error: 'Missing metric' });
      }

      if (value === undefined || value === null || Number.isNaN(Number(value))) {
        return res.status(400).json({ error: 'Missing or invalid value' });
      }

      try {
        await Promise.resolve(measuring.add(metric, Number(value)));
        res.status(200).json({ success: true });
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
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
    app.get(
      '/services/measuring/api/list/:metric/:datestart/:dateend',
      async (req, res) => {
        try {
          const measures = await Promise.resolve(
            measuring.list(
              req.params.metric,
              parseDateSegment(req.params.datestart),
              parseDateSegment(req.params.dateend)
            )
          );
          res.status(200).json(measures);
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      }
    );

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
    app.get(
      '/services/measuring/api/total/:metric/:datestart/:dateend',
      async (req, res) => {
        try {
          const total = await Promise.resolve(
            measuring.total(
              req.params.metric,
              parseDateSegment(req.params.datestart),
              parseDateSegment(req.params.dateend)
            )
          );
          res.status(200).json(total);
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      }
    );

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
    app.get(
      '/services/measuring/api/average/:metric/:datestart/:dateend',
      async (req, res) => {
        try {
          const average = await Promise.resolve(
            measuring.average(
              req.params.metric,
              parseDateSegment(req.params.datestart),
              parseDateSegment(req.params.dateend)
            )
          );
          res.status(200).json(average);
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      }
    );

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

    /**
     * GET /services/measuring/api/analytics/summary
     * Provides aggregate analytics for dashboard consumption.
     *
     * @param {express.Request} req
     * @param {express.Response} res
     * @return {void}
     */
    app.get('/services/measuring/api/analytics/summary', (req, res) => {
      if (!analytics) {
        return res.status(503).json({
          error: 'Analytics module not available'
        });
      }

      const countLimit = Number.parseInt(req.query.topLimit, 10);
      const recentLimit = capLimit(Number.parseInt(req.query.recentLimit, 10));
      const historyLimit = Number.parseInt(req.query.historyLimit, 10);

      try {
        res.status(200).json({
          totals: {
            uniqueMetrics: analytics.getUniqueMetricCount(),
            totalMeasurements: analytics.getMeasurementCount()
          },
          topByActivity: analytics.getTopMetricsByCount(
            Number.isNaN(countLimit) ? 10 : Math.min(countLimit, 100)
          ),
          topByRecency: analytics.getTopMetricsByRecency(
            Number.isNaN(recentLimit) ? 100 : Math.min(recentLimit, 250)
          ),
          recentHistory: analytics.getRecentHistory(
            Number.isNaN(historyLimit) ? 25 : Math.min(historyLimit, 250)
          )
        });
      } catch (err) {
        sendSafeError(res, err, {
          status: 500,
          eventEmitter,
          clientMessage: 'Failed to generate analytics summary'
        });
      }
    });

    /**
     * GET /services/measuring/api/settings
     * Retrieves the settings for the measuring service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/measuring/api/settings', async (req, res) => {
      try {
        const settings = await measuring.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('api-measuring-settings-error', err.message);
        res.status(500).json({
          error: 'Failed to retrieve settings'
        });
      }
    });

    /**
     * POST /services/measuring/api/settings
     * Saves the settings for the measuring service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/measuring/api/settings', async (req, res) => {
      const message = req.body;
      if (message) {
        try {
          await measuring.saveSettings(message);
          res.status(200).json({ success: true });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      } else {
        res.status(400).json({ error: 'Missing settings' });
      }
    });

    /**
     * GET /services/measuring/api/metrics
     * Retrieves all available metrics and their values for UI display.
     * Returns lists of unique metrics and all recorded values.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/measuring/api/metrics', async (req, res) => {
      try {
        const metricsSet = new Set();
        const values = [];

        // The dashboard's analytics module is the shared source of truth: it
        // captures every measuring event (add/increment/gauge/timing/histogram)
        // regardless of which provider or instance emitted it. Sourcing the UI
        // from it keeps the Metrics Explorer consistent with the Dashboard,
        // rather than only reflecting this one provider's in-memory Map.
        const analyticsMetricNames = new Set();
        if (analytics) {
          // Metric names - includes metrics whose history has rolled off.
          if (typeof analytics.getTopMetricsByRecency === 'function') {
            analytics.getTopMetricsByRecency(1000).forEach(stat => {
              metricsSet.add(stat.metric);
              analyticsMetricNames.add(stat.metric);
            });
          }
          // Individual values with timestamps from the rolling history.
          if (typeof analytics.getRecentHistory === 'function') {
            analytics.getRecentHistory(1000).forEach(entry => {
              metricsSet.add(entry.metric);
              values.push({
                metric: entry.metric,
                value: entry.value,
                timestamp: entry.capturedAt
              });
            });
          }
        }

        // Also include values held directly on a provider instance (e.g. the
        // default Map-based provider). Skip metrics already represented by the
        // analytics history above to avoid double-counting.
        if (measuring.metrics instanceof Map) {
          for (const [metricName, measures] of measuring.metrics) {
            metricsSet.add(metricName);
            if (analyticsMetricNames.has(metricName)) continue;
            if (Array.isArray(measures)) {
              measures.forEach(measure => {
                values.push({
                  metric: metricName,
                  value: measure.value,
                  timestamp: measure.timestamp || new Date()
                });
              });
            }
          }
        }

        // Sort results
        const uniqueMetrics = [...metricsSet].sort();
        const sortedValues = values.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.status(200).json({
          success: true,
          metrics: uniqueMetrics,
          values: sortedValues
        });
      } catch (err) {
        eventEmitter.emit('api-measuring-metrics-error', { error: err.message, endpoint: '/metrics' });
        res.status(500).json({
          success: false,
          error: 'Failed to retrieve metrics',
          metrics: [],
          values: []
        });
      }
    });
  }
};
