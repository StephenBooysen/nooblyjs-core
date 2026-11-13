/**
 * @fileoverview Task queue API routes for Express.js application.
 * Provides RESTful endpoints for FIFO task queue operations including
 * enqueue, dequeue, size monitoring, and service status reporting.
 *
 * Supports multiple named instances of queueing service through optional
 * instance parameter in URL paths.
 *
 * @author NooblyJS Core Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getServiceInstance } = require('../../appservice/utils/routeUtils');
const { sendSafeError } = require('../../shared/utils/safeError');
const { toClientResponse } = require('../../shared/utils/httpErrors');

/**
 * Configures and registers queueing routes with the Express application.
 * Sets up endpoints for task queue management operations with support for multiple named queues.
 * Supports both default routes and instance-specific routes.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} options.ServiceRegistry - ServiceRegistry singleton for instance lookup
 * @param {string} options.instanceName - Current instance name
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} queue - The queue provider instance with enqueue/dequeue methods
 * @return {void}
 */
module.exports = (options, eventEmitter, queue) => {
  if (options['express-app'] && queue) {
    const app = options['express-app'];
    const authMiddleware = options.authMiddleware;
    const currentInstanceName = options.instanceName || 'default';
    const ServiceRegistry = options.ServiceRegistry;
    const providerType = options.providerType || 'memory';

    // Enforce authentication on every queueing API endpoint via a single
    // path-mounted guard. Closes gaps where analytics/settings/instances routes
    // were unguarded while only queue operations carried an inline guard. The
    // /services/queueing/scripts client asset lives outside /api and stays
    // public. Falls back to a pass-through only when no auth is configured.
    const requireApiAuth = authMiddleware || ((req, res, next) => next());
    app.use('/services/queueing/api', requireApiAuth);

    /**
     * GET /services/queueing/scripts
     * Serves the client-side JavaScript library for consuming the queueing service API
     * Allows front-end applications to interact with the queueing service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/scripts', (req, res) => {
      try {
        const scriptPath = path.join(__dirname, '..', 'scripts', 'client.js');
        const scriptContent = fs.readFileSync(scriptPath, 'utf8');
        res.setHeader('Content-Type', 'application/javascript');
        res.status(200).send(scriptContent);
        eventEmitter.emit('api-queueing-scripts-served', 'Queueing script library served');
      } catch (error) {
        eventEmitter.emit('api-queueing-scripts-error', error.message);
        res.status(500).json({ success: false, error: 'Failed to load script library' });
      }
    });

    /**
     * GET /services/queueing/api/swagger/docs.json
     * Serves the Swagger/OpenAPI documentation JSON for the queueing service API
     * Contains complete API specification for API clients and documentation tools.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/api/swagger/docs.json', (req, res) => {
      try {
        const docsPath = path.join(__dirname, 'swagger', 'docs.json');
        const docsContent = fs.readFileSync(docsPath, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(docsContent);
        eventEmitter.emit('api-queueing-swagger-docs-served', 'Queueing Swagger documentation served');
      } catch (error) {
        eventEmitter.emit('api-queueing-swagger-docs-error', error.message);
        res.status(500).json({ success: false, error: 'Failed to load Swagger documentation' });
      }
    });

    /**
     * Creates an async handler for enqueue operations
     * @param {Object} queue - Queue instance
     * @returns {Function} Express middleware function
     */
    const createEnqueueHandler = (queue) => {
      return async (req, res) => {
        const { queueName } = req.params;
        const { task } = req.body;
        if (!queueName) {
          return res.status(400).json({ error: 'Bad Request: Missing queue name' });
        }
        if (task) {
          try {
            await queue.enqueue(queueName, task);
            eventEmitter.emit('api-queueing-enqueue', { queueName });
            res.status(200).json({ success: true });
          } catch (err) {
            eventEmitter.emit('api-queueing-enqueue-error', { error: err.message });
            sendSafeError(res, err, { status: 500, eventEmitter });
          }
        } else {
          res.status(400).json({ error: 'Bad Request: Missing task' });
        }
      };
    };

    /**
     * POST /services/queueing/api/enqueue/:queueName
     * Adds a task to the end of the specified queue for processing.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.queueName - The name of the queue
     * @param {*} req.body.task - The task object to add to the queue
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/queueing/api/enqueue/:queueName',
      createEnqueueHandler(queue)
    );

    /**
     * POST /services/queueing/api/:instanceName/enqueue/:queueName
     * Adds a task to the end of a named queue instance for processing.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The queue instance name
     * @param {string} req.params.queueName - The name of the queue
     * @param {*} req.body.task - The task object to add to the queue
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/queueing/api/:instanceName/enqueue/:queueName',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const queueInstance = getServiceInstance('queueing', instanceName, queue, options, providerType);
        createEnqueueHandler(queueInstance)(req, res);
      }
    );

    /**
     * Creates an async handler for dequeue operations
     * @param {Object} queue - Queue instance
     * @returns {Function} Express middleware function
     */
    const createDequeueHandler = (queue) => {
      return async (req, res) => {
        const { queueName } = req.params;
        if (!queueName) {
          return res.status(400).json({ error: 'Bad Request: Missing queue name' });
        }
        try {
          const task = await queue.dequeue(queueName);
          eventEmitter.emit('api-queueing-dequeue', { queueName });
          res.status(200).json(task);
        } catch (err) {
          eventEmitter.emit('api-queueing-dequeue-error', { error: err.message });
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      };
    };

    /**
     * GET /services/queueing/api/dequeue/:queueName
     * Removes and returns the next task from the front of the specified queue.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.queueName - The name of the queue
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/queueing/api/dequeue/:queueName',
      createDequeueHandler(queue)
    );

    /**
     * GET /services/queueing/api/:instanceName/dequeue/:queueName
     * Removes and returns the next task from the front of a named queue instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The queue instance name
     * @param {string} req.params.queueName - The name of the queue
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/queueing/api/:instanceName/dequeue/:queueName',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const queueInstance = getServiceInstance('queueing', instanceName, queue, options, providerType);
        createDequeueHandler(queueInstance)(req, res);
      }
    );

    /**
     * Creates an async handler for size operations
     * @param {Object} queue - Queue instance
     * @returns {Function} Express middleware function
     */
    const createSizeHandler = (queue) => {
      return async (req, res) => {
        const { queueName } = req.params;
        if (!queueName) {
          return res.status(400).json({ error: 'Bad Request: Missing queue name' });
        }
        try {
          const size = await queue.size(queueName);
          eventEmitter.emit('api-queueing-size', { queueName });
          res.status(200).json(size);
        } catch (err) {
          eventEmitter.emit('api-queueing-size-error', { error: err.message });
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      };
    };

    /**
     * GET /services/queueing/api/size/:queueName
     * Returns the current number of tasks in the specified queue.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.queueName - The name of the queue
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/queueing/api/size/:queueName',
      createSizeHandler(queue)
    );

    /**
     * GET /services/queueing/api/:instanceName/size/:queueName
     * Returns the current number of tasks in a named queue instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The queue instance name
     * @param {string} req.params.queueName - The name of the queue
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/queueing/api/:instanceName/size/:queueName',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const queueInstance = getServiceInstance('queueing', instanceName, queue, options, providerType);
        createSizeHandler(queueInstance)(req, res);
      }
    );

    /**
     * Creates an async handler for list operations
     * @param {Object} queue - Queue instance
     * @returns {Function} Express middleware function
     */
    const createListHandler = (queue) => {
      return async (req, res) => {
        try {
          const queues = await queue.listQueues();
          eventEmitter.emit('api-queueing-list', { count: queues.length });
          res.status(200).json(queues);
        } catch (err) {
          eventEmitter.emit('api-queueing-list-error', { error: err.message });
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      };
    };

    /**
     * GET /services/queueing/api/queues
     * Returns a list of all queue names.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/queueing/api/queues',
      createListHandler(queue)
    );

    /**
     * GET /services/queueing/api/:instanceName/queues
     * Returns a list of all queue names from a named queue instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The queue instance name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/queueing/api/:instanceName/queues',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const queueInstance = getServiceInstance('queueing', instanceName, queue, options, providerType);
        createListHandler(queueInstance)(req, res);
      }
    );

    /**
     * Creates an async handler for purge operations
     * @param {Object} queue - Queue instance
     * @returns {Function} Express middleware function
     */
    const createPurgeHandler = (queue) => {
      return async (req, res) => {
        const { queueName } = req.params;
        if (!queueName) {
          return res.status(400).json({ error: 'Bad Request: Missing queue name' });
        }
        try {
          await queue.purge(queueName);
          eventEmitter.emit('api-queueing-purge', { queueName });
          res.status(200).json({ success: true });
        } catch (err) {
          eventEmitter.emit('api-queueing-purge-error', { error: err.message });
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      };
    };

    /**
     * DELETE /services/queueing/api/purge/:queueName
     * Purges all items from the specified queue.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.queueName - The name of the queue to purge
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(
      '/services/queueing/api/purge/:queueName',
      createPurgeHandler(queue)
    );

    /**
     * DELETE /services/queueing/api/:instanceName/purge/:queueName
     * Purges all items from a named queue instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The queue instance name
     * @param {string} req.params.queueName - The name of the queue to purge
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(
      '/services/queueing/api/:instanceName/purge/:queueName',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const queueInstance = getServiceInstance('queueing', instanceName, queue, options, providerType);
        createPurgeHandler(queueInstance)(req, res);
      }
    );

    /**
     * GET /services/queueing/api/status
     * Returns the operational status of the queueing service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    /**
     * Registers the reliable-job routes (feature 06) under a prefix. The default
     * instance uses `queue`; the `/:instanceName` variant resolves a named instance.
     *
     * @param {string} prefix - Route prefix, e.g. `/services/queueing/api`
     * @param {function(express.Request): Object} resolveQueue - Returns the queue for a request
     * @return {void}
     */
    const registerReliableRoutes = (prefix, resolveQueue) => {
      /** POST {prefix}/queues/:queueName/jobs - adds a reliable job; body `{ data, options }`. */
      app.post(`${prefix}/queues/:queueName/jobs`, async (req, res) => {
        try {
          const body = req.body && typeof req.body === 'object' ? req.body : {};
          if (body.options !== undefined && (body.options === null || typeof body.options !== 'object' || Array.isArray(body.options))) {
            return res.status(400).json({ success: false, error: 'options must be an object' });
          }
          const id = await resolveQueue(req).enqueue(req.params.queueName, body.data, body.options || {});
          eventEmitter?.emit('queue:job-enqueued-api', { queueName: req.params.queueName, id });
          res.status(201).json({ success: true, data: { id } });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });

      /** GET {prefix}/queues/:queueName/jobs/:jobId - a job's state, attempts and last error. */
      app.get(`${prefix}/queues/:queueName/jobs/:jobId`, async (req, res) => {
        try {
          const job = await resolveQueue(req).getJob(req.params.jobId, req.params.queueName);
          if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
          }
          res.json({ success: true, data: job });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });

      /** POST {prefix}/queues/:queueName/retry-dead - requeues dead-lettered jobs with attempts reset. */
      app.post(`${prefix}/queues/:queueName/retry-dead`, async (req, res) => {
        try {
          const requeued = await resolveQueue(req).retryDeadLetters(req.params.queueName);
          eventEmitter?.emit('queue:dead-letters-retried', { queueName: req.params.queueName, requeued });
          res.json({ success: true, data: { requeued } });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });

      /** GET {prefix}/queues/:queueName/job-counts - reliable jobs counted by state. */
      app.get(`${prefix}/queues/:queueName/job-counts`, async (req, res) => {
        try {
          res.json({ success: true, data: await resolveQueue(req).jobCounts(req.params.queueName) });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });
    };

    registerReliableRoutes('/services/queueing/api', () => queue);
    registerReliableRoutes('/services/queueing/api/:instanceName', (req) =>
      getServiceInstance('queueing', req.params.instanceName, queue, options, providerType)
    );

    app.get('/services/queueing/api/status', (req, res) => {
      eventEmitter.emit('api-queueing-status', 'queueing api running');
      res.status(200).json('queueing api running');
    });

    /**
     * GET /services/queueing/api/instances
     * Returns a list of all available queueing service instances.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/api/instances', (req, res) => {
      try {
        const instances = [];

        // Add the default instance
        instances.push({
          name: 'default',
          provider: providerType,
          status: 'active'
        });

        // Get additional instances from ServiceRegistry if available
        if (ServiceRegistry) {
          const additionalInstances = ServiceRegistry.listInstances('queueing');
          if (additionalInstances && Array.isArray(additionalInstances)) {
            additionalInstances.forEach(instance => {
              // Skip the default instance to avoid duplication
              if (instance.instanceName !== 'default') {
                instances.push({
                  name: instance.instanceName,
                  provider: instance.providerType,
                  status: 'active'
                });
              }
            });
          }
        }

        eventEmitter.emit('api-queueing-instances', `retrieved ${instances.length} instances`);
        res.status(200).json({
          success: true,
          instances: instances,
          total: instances.length
        });
      } catch (error) {
        eventEmitter.emit('api-queueing-instances-error', error.message);
        const { status, message } = toClientResponse(error);
        res.status(status).json({
          success: false,
          error: message
        });
      }
    });

    // Helper function to create analytics handler
    const createAnalyticsHandler = (queue) => {
      return async (req, res) => {
        try {
          if (!queue.analytics) {
            return res.status(503).json({ error: 'Analytics not available' });
          }

          const stats = queue.analytics.getStats();
          const distribution = queue.analytics.getDistribution();
          const timeline = queue.analytics.getTimeline(10);
          const queueList = await queue.analytics.getQueueList(queue, 100);

          res.status(200).json({
            stats: stats,
            distribution: distribution,
            timeline: timeline,
            queueList: queueList
          });
        } catch (error) {
          sendSafeError(res, error, { status: 500, eventEmitter });
        }
      };
    };

    /**
     * GET /services/queueing/api/analytics
     * Returns analytics data for queue operations.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/api/analytics', createAnalyticsHandler(queue));

    /**
     * GET /services/queueing/api/:instanceName/analytics
     * Returns analytics data for a named queue instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The queue instance name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/queueing/api/:instanceName/analytics',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const queueInstance = getServiceInstance('queueing', instanceName, queue, options, providerType);
        createAnalyticsHandler(queueInstance)(req, res);
      }
    );

    /**
     * GET /services/queueing/api/settings
     * Retrieves the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/queueing/api/settings', async (req, res) => {
      try {
        const settings = await queue.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('api-queueing-settings-error', err.message);
        res.status(500).json({ error: 'Failed to retrieve settings' });
      }
    });

    /**
     * POST /services/queueing/api/settings
     * Saves the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/queueing/api/settings', async (req, res) => {
      const message = req.body;
      if (message) {
        try {
          await queue.saveSettings(message);
          eventEmitter.emit('api-queueing-settings-saved', { timestamp: Date.now() });
          res.status(200).json({ success: true });
        } catch (err) {
          eventEmitter.emit('api-queueing-settings-save-error', err.message);
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      } else {
        res.status(400).json({ error: 'Bad Request: Missing settings' });
      }
    });
  }
};
