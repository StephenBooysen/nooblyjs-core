/**
 * @fileoverview Notification API routes for Express.js application.
 * Provides RESTful endpoints for pub/sub messaging system with topic management,
 * subscription handling, and message broadcasting capabilities.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Configures and registers notification routes with the Express application.
 * Sets up endpoints for pub/sub messaging and subscription management.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} notifier - The notification provider instance
 * @return {void}
 */
module.exports = (options, eventEmitter, notifier) => {
  if (options['express-app'] && notifier) {
    const app = options['express-app'];

    /**
     * POST /services/notifying/api/topic
     * Creates a new notification topic for pub/sub messaging.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.body.topic - The topic name to create
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/notifying/api/topic', (req, res) => {
      const {topic} = req.body;
      if (topic) {
        notifier
          .createTopic(topic)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing topic');
      }
    });

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
    app.post('/services/notifying/api/subscribe/topic/:topic', (req, res) => {
      const topic = req.params.topic;
      const {callbackUrl} = req.body;
      if (topic && callbackUrl) {
        notifier
          .subscribe(topic, callbackUrl)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing topic or callback URL');
      }
    });

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
    app.post('/services/notifying/api/unsubscribe/topic/:topic', (req, res) => {
      const topic = req.params.topic;
      const {callbackUrl} = req.body;
      if (topic && callbackUrl) {
        notifier
          .unsubscribe(topic, callbackUrl)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing topic or callback URL');
      }
    });

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
    app.post('/services/notifying/api/notify/topic/:topic', (req, res) => {
      const topic = req.params.topic;
      const {message} = req.body;
      if (topic && message) {
        notifier
          .notify(topic, message)
          .then(() => res.status(200).send('OK'))
          .catch((err) => res.status(500).send(err.message));
      } else {
        res.status(400).send('Bad Request: Missing topic or message');
      }
    });

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
  }
};
