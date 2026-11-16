/**
 * @fileoverview Notification API routes for Express.js application.
 * Provides RESTful endpoints for pub/sub messaging system with topic management,
 * subscription handling, and message broadcasting capabilities.
 *
 * Supports multiple named instances of notifying service through optional
 * instance parameter in URL paths.
 *
 * @author NooblyJS Core Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const { getServiceInstance } = require('../../appservice/utils/routeUtils');
const { sendSafeError } = require('../../shared/utils/safeError');
const { capLimit, validate } = require('../../shared/utils/validation');

/**
 * Configures and registers notification routes with the Express application.
 * Sets up endpoints for pub/sub messaging and subscription management.
 * Supports both default routes and instance-specific routes.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} options.ServiceRegistry - ServiceRegistry singleton for instance lookup
 * @param {string} options.instanceName - Current instance name
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} notifier - The notification provider instance
 * @param {Object=} analytics - Analytics module for topic statistics
 * @return {void}
 */
module.exports = (options, eventEmitter, notifier, analytics) => {
  if (options['express-app'] && notifier) {
    const app = options['express-app'];
    const authMiddleware = options.authMiddleware;
    const currentInstanceName = options.instanceName || 'default';
    const ServiceRegistry = options.ServiceRegistry;
    const providerType = options.providerType || 'memory';

    // Enforce authentication on every notifying API endpoint via a single
    // path-mounted guard. This closes the gaps where read/analytics/settings
    // routes were previously unguarded while only mutations carried an inline
    // guard. Falls back to a pass-through only when no auth is configured.
    const requireApiAuth = authMiddleware || ((req, res, next) => next());
    app.use('/services/notifying/api', requireApiAuth);

    /**
     * Helper function to create topic handler
     * @param {Object} notifier - Notifier instance
     * @returns {Function} Express route handler
     */
    const createTopicHandler = (notifier) => {
      return async (req, res) => {
        const { topic } = req.body;
        if (topic) {
          try {
            await notifier.createTopic(topic);
            res.status(200).json({ success: true });
          } catch (err) {
            sendSafeError(res, err, { status: 500, eventEmitter });
          }
        } else {
          res.status(400).json({ error: 'Missing topic' });
        }
      };
    };

    /**
     * POST /services/notifying/api/topic
     * Creates a new notification topic for pub/sub messaging.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.body.topic - The topic name to create
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/topic',
      createTopicHandler(notifier)
    );

    /**
     * POST /services/notifying/api/:instanceName/topic
     * Creates a new notification topic in a named instance for pub/sub messaging.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The notifier instance name
     * @param {string} req.body.topic - The topic name to create
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/:instanceName/topic',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const notifierInstance = getServiceInstance('notifying', instanceName, notifier, options, providerType);
        createTopicHandler(notifierInstance)(req, res);
      }
    );

    /**
     * Helper function to create subscribe handler
     * @param {Object} notifier - Notifier instance
     * @returns {Function} Express route handler
     */
    const createSubscribeHandler = (notifier) => {
      return async (req, res) => {
        const topic = req.params.topic;
        const { callbackUrl } = req.body;
        if (topic && callbackUrl) {
          try {
            await notifier.subscribe(topic, callbackUrl);
            res.status(200).json({ success: true });
          } catch (err) {
            sendSafeError(res, err, { status: 500, eventEmitter });
          }
        } else {
          res.status(400).json({ error: 'Missing topic or callback URL' });
        }
      };
    };

    /**
     * POST /services/notifying/api/subscribe/topic/:topic
     * Subscribes a callback URL to receive notifications from a topic.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.topic - The topic to subscribe to
     * @param {string} req.body.callbackUrl - The callback URL for notifications
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/subscribe/topic/:topic',
      createSubscribeHandler(notifier)
    );

    /**
     * POST /services/notifying/api/:instanceName/subscribe/topic/:topic
     * Subscribes a callback URL to a topic in a named instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The notifier instance name
     * @param {string} req.params.topic - The topic to subscribe to
     * @param {string} req.body.callbackUrl - The callback URL for notifications
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/:instanceName/subscribe/topic/:topic',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const notifierInstance = getServiceInstance('notifying', instanceName, notifier, options, providerType);
        createSubscribeHandler(notifierInstance)(req, res);
      }
    );

    /**
     * Helper function to create unsubscribe handler
     * @param {Object} notifier - Notifier instance
     * @returns {Function} Express route handler
     */
    const createUnsubscribeHandler = (notifier) => {
      return async (req, res) => {
        const topic = req.params.topic;
        const { callbackUrl } = req.body;
        if (topic && callbackUrl) {
          try {
            await notifier.unsubscribe(topic, callbackUrl);
            res.status(200).json({ success: true });
          } catch (err) {
            sendSafeError(res, err, { status: 500, eventEmitter });
          }
        } else {
          res.status(400).json({ error: 'Missing topic or callback URL' });
        }
      };
    };

    /**
     * POST /services/notifying/api/unsubscribe/topic/:topic
     * Unsubscribes a callback URL from a topic's notifications.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.topic - The topic to unsubscribe from
     * @param {string} req.body.callbackUrl - The callback URL to remove
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/unsubscribe/topic/:topic',
      createUnsubscribeHandler(notifier)
    );

    /**
     * POST /services/notifying/api/:instanceName/unsubscribe/topic/:topic
     * Unsubscribes a callback URL from a topic in a named instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The notifier instance name
     * @param {string} req.params.topic - The topic to unsubscribe from
     * @param {string} req.body.callbackUrl - The callback URL to remove
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/:instanceName/unsubscribe/topic/:topic',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const notifierInstance = getServiceInstance('notifying', instanceName, notifier, options, providerType);
        createUnsubscribeHandler(notifierInstance)(req, res);
      }
    );

    /**
     * Helper function to create notify handler
     * @param {Object} notifier - Notifier instance
     * @returns {Function} Express route handler
     */
    const createNotifyHandler = (notifier) => {
      return async (req, res) => {
        const topic = req.params.topic;
        const { message } = req.body;
        if (topic && message) {
          try {
            await notifier.notify(topic, message);
            res.status(200).json({ success: true });
          } catch (err) {
            sendSafeError(res, err, { status: 500, eventEmitter });
          }
        } else {
          res.status(400).json({ error: 'Missing topic or message' });
        }
      };
    };

    /**
     * POST /services/notifying/api/notify/topic/:topic
     * Sends a notification message to all subscribers of a topic.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.topic - The topic to send notification to
     * @param {*} req.body.message - The message to broadcast to subscribers
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/notify/topic/:topic',
      createNotifyHandler(notifier)
    );

    /**
     * POST /services/notifying/api/:instanceName/notify/topic/:topic
     * Sends a notification message to subscribers of a topic in a named instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The notifier instance name
     * @param {string} req.params.topic - The topic to send notification to
     * @param {*} req.body.message - The message to broadcast to subscribers
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/notifying/api/:instanceName/notify/topic/:topic',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const notifierInstance = getServiceInstance('notifying', instanceName, notifier, options, providerType);
        createNotifyHandler(notifierInstance)(req, res);
      }
    );

    /**
     * Helper function to create a notification-history handler.
     * @param {Object} notifier - Notifier instance
     * @returns {Function} Express route handler
     */
    const createNotificationsHandler = (notifier) => {
      return (req, res) => {
        try {
          const notifications = typeof notifier.getNotifications === 'function'
            ? notifier.getNotifications()
            : [];
          res.status(200).json({ success: true, notifications });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      };
    };

    /**
     * GET /services/notifying/api/notifications
     * Returns the recorded history of published notifications, newest first.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/notifying/api/notifications',
      createNotificationsHandler(notifier)
    );

    /**
     * GET /services/notifying/api/:instanceName/notifications
     * Returns the notification history for a named notifier instance.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.instanceName - The notifier instance name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/notifying/api/:instanceName/notifications',
      (req, res) => {
        const instanceName = req.params.instanceName;
        const notifierInstance = getServiceInstance('notifying', instanceName, notifier, options, providerType);
        createNotificationsHandler(notifierInstance)(req, res);
      }
    );

    /**
     * GET /services/notifying/api/status
     * Returns the operational status of the notification service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/notifying/api/status', (req, res) => {
      eventEmitter.emit('api-notifying-status', 'notifying api running');
      res.status(200).json('notifying api running');
    });

    if (analytics) {
      /**
       * Helper function to get analytics for an instance
       * @param {string} instanceName - Instance name
       * @returns {Object} Analytics instance
       */
      const getAnalyticsInstance = (instanceName) => {
        if (!instanceName || instanceName === 'default') {
          return analytics;
        }

        // Try to get from service registry if available
        const notifierInstance = ServiceRegistry ? ServiceRegistry.getServiceInstance('notifying', providerType, instanceName) : null;
        if (notifierInstance && notifierInstance.analytics) {
          return notifierInstance.analytics;
        }

        // Return default analytics
        return analytics;
      };

      app.get('/services/notifying/api/analytics/overview', (req, res) => {
        try {
          const overview = analytics.getOverview();
          res.status(200).json(overview);
        } catch (error) {
          res.status(500).json({ error: 'Failed to retrieve notifying overview' });
        }
      });

      app.get('/services/notifying/api/:instanceName/analytics/overview', (req, res) => {
        try {
          const instanceName = req.params.instanceName;
          const analyticsInstance = getAnalyticsInstance(instanceName);
          const overview = analyticsInstance.getOverview();
          res.status(200).json(overview);
        } catch (error) {
          res.status(500).json({ error: 'Failed to retrieve notifying overview' });
        }
      });

      app.get('/services/notifying/api/analytics/top-topics', (req, res) => {
        try {
          const limit = capLimit(parseInt(req.query.limit, 10));
          const topics = analytics.getTopTopics(Number.isNaN(limit) ? undefined : limit);
          res.status(200).json({
            topics,
          });
        } catch (error) {
          res.status(500).json({ error: 'Failed to retrieve top topics' });
        }
      });

      app.get('/services/notifying/api/:instanceName/analytics/top-topics', (req, res) => {
        try {
          const instanceName = req.params.instanceName;
          const analyticsInstance = getAnalyticsInstance(instanceName);
          const limit = capLimit(parseInt(req.query.limit, 10));
          const topics = analyticsInstance.getTopTopics(Number.isNaN(limit) ? undefined : limit);
          res.status(200).json({
            topics,
          });
        } catch (error) {
          res.status(500).json({ error: 'Failed to retrieve top topics' });
        }
      });

      app.get('/services/notifying/api/analytics/topics', (req, res) => {
        try {
          const limit = capLimit(parseInt(req.query.limit, 10));
          const topics = analytics.getTopicDetails(Number.isNaN(limit) ? undefined : limit);
          res.status(200).json({
            topics,
          });
        } catch (error) {
          res.status(500).json({ error: 'Failed to retrieve topic list' });
        }
      });

      app.get('/services/notifying/api/:instanceName/analytics/topics', (req, res) => {
        try {
          const instanceName = req.params.instanceName;
          const analyticsInstance = getAnalyticsInstance(instanceName);
          const limit = capLimit(parseInt(req.query.limit, 10));
          const topics = analyticsInstance.getTopicDetails(Number.isNaN(limit) ? undefined : limit);
          res.status(200).json({
            topics,
          });
        } catch (error) {
          res.status(500).json({ error: 'Failed to retrieve topic list' });
        }
      });
    }

    // Outbound webhooks (feature 12). Only registered when the provider has them.
    if (typeof notifier.listWebhooks === 'function') {
      const webhookWrite = validate({
        body: {
          url: { type: 'string', required: true, maxLength: 2048 },
          events: { type: 'array', required: true, maxLength: 100 },
          description: { type: 'string', maxLength: 300 },
          secret: { type: 'string', maxLength: 256 }
        }
      });

      /**
       * GET /services/notifying/api/webhooks
       * Lists webhook subscriptions. Secrets are masked.
       *
       * @param {express.Request} req - Express request object
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.get('/services/notifying/api/webhooks', async (req, res) => {
        try {
          res.status(200).json({ subscriptions: await notifier.listWebhooks() });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });

      /**
       * POST /services/notifying/api/webhooks
       * Creates a subscription. The generated secret is returned once, here.
       *
       * @param {express.Request} req - Express request object
       * @param {string} req.body.url - Public HTTPS endpoint to deliver to
       * @param {string[]} req.body.events - Event names, or ['*']
       * @param {string=} req.body.description - Free-text label
       * @param {string=} req.body.secret - Signing secret (generated when omitted)
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.post('/services/notifying/api/webhooks', webhookWrite, async (req, res) => {
        try {
          const created = await notifier.subscribeWebhook(req.body);
          res.status(201).json(created);
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });

      /**
       * DELETE /services/notifying/api/webhooks/:id
       * Removes a subscription. Queued deliveries for it are dropped when they run.
       *
       * @param {express.Request} req - Express request object
       * @param {string} req.params.id - Subscription id
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.delete('/services/notifying/api/webhooks/:id', async (req, res) => {
        try {
          const removed = await notifier.unsubscribeWebhook(req.params.id);
          if (!removed) return res.status(404).json({ error: 'Subscription not found' });
          res.status(200).json({ success: true });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });

      /**
       * POST /services/notifying/api/webhooks/publish
       * Queues a delivery of an event to every active subscription listening for it.
       *
       * @param {express.Request} req - Express request object
       * @param {string} req.body.event - Event name, for example order.created
       * @param {*} req.body.data - JSON payload
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.post('/services/notifying/api/webhooks/publish', validate({
        body: { event: { type: 'string', required: true, maxLength: 120 } }
      }), async (req, res) => {
        try {
          res.status(202).json(await notifier.publish(req.body.event, req.body.data));
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });

      /**
       * GET /services/notifying/api/webhooks/deliveries
       * Recent deliveries, newest first. Bodies are not returned.
       *
       * @param {express.Request} req - Express request object
       * @param {string=} req.query.limit - Most entries to return (max 500)
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.get('/services/notifying/api/webhooks/deliveries', validate({
        query: { limit: { type: 'integer', min: 1, max: 500 } }
      }), (req, res) => {
        const limit = req.query.limit ? Number(req.query.limit) : 50;
        res.status(200).json({ deliveries: notifier.webhookDeliveries(limit) });
      });

      /**
       * POST /services/notifying/api/webhooks/deliveries/:deliveryId/redeliver
       * Queues another delivery of an earlier event under a new delivery id.
       *
       * @param {express.Request} req - Express request object
       * @param {string} req.params.deliveryId - Delivery to send again
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.post('/services/notifying/api/webhooks/deliveries/:deliveryId/redeliver', async (req, res) => {
        try {
          res.status(202).json(await notifier.redeliverWebhook(req.params.deliveryId));
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      });
    }

    /**
     * GET /services/notifying/api/settings
     * Retrieves the settings for the notifying service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/notifying/api/settings', async (req, res) => {
      try {
        const settings = await notifier.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('api-notifying-settings-error', err.message);
        res.status(500).json({ error: 'Failed to retrieve settings' });
      }
    });

    /**
     * POST /services/notifying/api/settings
     * Saves the settings for the notifying service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/notifying/api/settings', async (req, res) => {
      const message = req.body;
      if (message) {
        try {
          await notifier.saveSettings(message);
          res.status(200).json({ success: true });
        } catch (err) {
          sendSafeError(res, err, { status: 500, eventEmitter });
        }
      } else {
        res.status(400).json({ error: 'Missing settings' });
      }
    });

    /**
     * GET /services/notifying/api/instances
     * Returns a list of all available notifying service instances.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/notifying/api/instances', (req, res) => {
      try {
        if (!ServiceRegistry) {
          res.status(200).json({
            instances: ['default']
          });
          return;
        }

        const instances = new Set();
        // Iterate through all services in the registry
        for (const key of ServiceRegistry.services.keys()) {
          const [serviceName, provider, instanceName] = key.split(':');
          if (serviceName === 'notifying' && provider === providerType) {
            instances.add(instanceName);
          }
        }

        res.status(200).json({
          instances: Array.from(instances).sort()
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve instances' });
      }
    });

    /**
     * GET /services/notifying/api/swagger/docs.json
     * Returns the OpenAPI/Swagger specification for the Notifying Service API.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/notifying/api/swagger/docs.json', (req, res) => {
      try {
        const swaggerDocs = require('./swagger/docs.json');
        res.status(200).json(swaggerDocs);
      } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve Swagger documentation' });
      }
    });
  }
};
