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
const { parseLimit } = require('../../shared/utils/validation');
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

    // ---- Feature 06: reliable jobs ---------------------------------------
    // Registered before the instance-aware routes so `/jobs/...` is never read
    // as an instance name. A named instance is chosen with `?instance=`.
    const jobsQueue = (req) => (req.query.instance
      ? getServiceInstance('queueing', String(req.query.instance), queue, options, providerType)
      : queue);
    const jobsRoute = (handler) => async (req, res) => {
      const q = jobsQueue(req);
      if (!q || !q.supportsJobs) {
        return res.status(501).json({ error: 'This queue provider does not support reliable jobs', code: 'JOBS_UNSUPPORTED' });
      }
      try {
        await handler(q, req, res);
      } catch (err) {
        sendSafeError(res, err, { status: 500, eventEmitter });
      }
    };
    const QUEUE_NAME = /^[A-Za-z0-9._:-]{1,200}$/;
    const checkQueueName = (req, res) => {
      if (!QUEUE_NAME.test(req.params.queueName)) {
        res.status(400).json({ error: 'Invalid queue name' });
        return false;
      }
      return true;
    };

    /** GET /services/queueing/api/jobs — job queues with counts by state. */
    app.get('/services/queueing/api/jobs', jobsRoute(async (q, req, res) => {
      const names = await q.jobQueues();
      const queues = await Promise.all(names.slice(0, 500).map(async (name) => ({ name, ...(await q.jobCounts(name)) })));
      res.json({ queues, durable: Boolean(q.jobsDurable) });
    }));

    /** GET /services/queueing/api/jobs/:queueName/counts */
    app.get('/services/queueing/api/jobs/:queueName/counts', jobsRoute(async (q, req, res) => {
      if (!checkQueueName(req, res)) return;
      res.json(await q.jobCounts(req.params.queueName));
    }));

    /** GET /services/queueing/api/jobs/:queueName/dead?limit= — dead-letter list. */
    app.get('/services/queueing/api/jobs/:queueName/dead', jobsRoute(async (q, req, res) => {
      if (!checkQueueName(req, res)) return;
      const limit = parseLimit(req.query.limit, { defaultValue: 100, max: 1000 });
      res.json({ jobs: await q.listDeadLetters(req.params.queueName, limit) });
    }));

    /** POST /services/queueing/api/jobs/:queueName/dead/retry — `{ ids? }`; all when omitted. */
    app.post('/services/queueing/api/jobs/:queueName/dead/retry', jobsRoute(async (q, req, res) => {
      if (!checkQueueName(req, res)) return;
      const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids.filter((i) => typeof i === 'string').slice(0, 10000) : undefined;
      const retried = await q.retryDeadLetters(req.params.queueName, ids ? { ids } : {});
      eventEmitter.emit('api-queueing-dead-retry', { queueName: req.params.queueName, retried });
      res.json({ retried });
    }));

    /** GET /services/queueing/api/jobs/:queueName/job/:jobId */
    app.get('/services/queueing/api/jobs/:queueName/job/:jobId', jobsRoute(async (q, req, res) => {
      if (!checkQueueName(req, res)) return;
      const job = await q.getJob(req.params.jobId);
      if (!job || job.queue !== req.params.queueName) return res.status(404).json({ error: 'Job not found' });
      res.json(job);
    }));

    /** DELETE /services/queueing/api/jobs/:queueName/job/:jobId */
    app.delete('/services/queueing/api/jobs/:queueName/job/:jobId', jobsRoute(async (q, req, res) => {
      if (!checkQueueName(req, res)) return;
      const removed = await q.removeJob(req.params.queueName, req.params.jobId);
      if (!removed) return res.status(404).json({ error: 'Job not found' });
      res.json({ removed: true });
    }));

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
            // Feature 06: `options` ({ attempts, delayMs, backoff, priority,
            // idempotencyKey }) makes it a reliable job and returns its id.
            const jobOptions = req.body.options;
            if (jobOptions !== undefined && (typeof jobOptions !== 'object' || jobOptions === null || Array.isArray(jobOptions))) {
              return res.status(400).json({ error: 'options must be an object' });
            }
            const jobId = await queue.enqueue(queueName, task, jobOptions);
            eventEmitter.emit('api-queueing-enqueue', { queueName });
            res.status(200).json(jobId ? { success: true, jobId } : { success: true });
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
