/**
 * @fileoverview Notification Service Factory
 * Factory module for creating notification service instances.
 * Provides topic-based messaging, subscriber management, and event broadcasting.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';
const NotificationService = require('./providers/notifying');
const NotifyingApi = require('./providers/notifyingApi');
const Routes = require('./routes');
const Views = require('./views');
const Scripts = require('./scripts');
const NotifyingAnalytics = require('./modules/analytics');
const { WebhookDispatcher } = require('./modules/webhooks');

/**
 * Creates a notification service instance with messaging capabilities.
 * Automatically configures routes and views for the notification service.
 * Supports multiple named instances through the instanceName option.
 *
 * @param {string} type - The notification service type ('default', 'api')
 * @param {Object} options - Configuration options for the notification service
 * @param {string} [options.instanceName='default'] - Unique identifier for this notifying instance
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {Object} options.dependencies.queueing - Queueing service instance
 * @param {Object} options.dependencies.scheduling - Scheduling service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {NotificationService|NotifyingApi} Notification service instance for messaging
 * @throws {Error} When unsupported notification type is provided
 * @example
 * const highPriority = createNotificationService('default', {
 *   instanceName: 'high',
 *   dependencies: { logging, queueing, scheduling }
 * }, eventEmitter);
 *
 * const normalPriority = createNotificationService('default', {
 *   instanceName: 'normal',
 *   dependencies: { logging, queueing, scheduling }
 * }, eventEmitter);
 *
 * // Subscribe to a topic on high priority instance
 * await highPriority.subscribe('critical_alerts', callbackUrl);
 *
 * // Publish a message to a topic
 * await highPriority.notify('critical_alerts', {
 *   type: 'system_alert',
 *   severity: 'critical',
 *   timestamp: new Date()
 * });
 */
function createNotificationService(type, options, eventEmitter) {
  // Create notification service instance
  let notifying;
  let analytics = null;

  switch (type) {
    case 'api':
      notifying = new NotifyingApi(options, eventEmitter);
      break;
    case 'default':
    default:
      notifying = new NotificationService(options, eventEmitter);
      break;
  }

  // Initialize analytics module with instance name support
  const instanceName = (options && options.instanceName) || 'default';
  analytics = new NotifyingAnalytics(eventEmitter, notifying, instanceName);

  // Outbound webhooks (feature 12). Deliveries run on the reliable queue, so
  // this needs the queueing and settings services, which the registry injects.
  const deps = (options && options.dependencies) || {};
  if (deps.queueing && deps.settings) {
    const webhookOptions = (options && options.webhooks) || {};
    const dispatcher = new WebhookDispatcher({
      queue: deps.queueing,
      settings: deps.settings,
      logger: deps.logging,
      eventEmitter,
      ...webhookOptions
    });
    notifying.webhooks = dispatcher;
    notifying.subscribeWebhook = (input) => dispatcher.subscribe(input);
    notifying.listWebhooks = () => dispatcher.list();
    notifying.unsubscribeWebhook = (id) => dispatcher.unsubscribe(id);
    notifying.publish = (event, payload) => dispatcher.publish(event, payload);
    notifying.redeliverWebhook = (deliveryId) => dispatcher.redeliver(deliveryId);
    notifying.webhookDeliveries = (limit) => dispatcher.deliveries(limit);
    // The registry calls stopConsumers() on shutdown and reset.
    notifying.stopConsumers = () => dispatcher.stop();
  }
  // Initialize routes, views, and scripts for the notification service
  Routes(options, eventEmitter, notifying, analytics);
  Views(options, eventEmitter, notifying);
  Scripts(options, eventEmitter, notifying);

  // Expose settings methods (save provider methods before overwriting)
  const providerGetSettings = notifying.getSettings.bind(notifying);
  const providerSaveSettings = notifying.saveSettings.bind(notifying);
  const service = notifying;
  service.getSettings = providerGetSettings;
  service.saveSettings = providerSaveSettings;

  // Expose analytics so the registry can remove its listeners on shutdown/reset
  // (P2-6); the notifying routes also read it per instance.
  service.analytics = analytics;

  return service;
}

module.exports = createNotificationService;
