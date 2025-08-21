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
const NotificationService = require('./provider/notifying');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a notification service instance with messaging capabilities.
 * Automatically configures routes and views for the notification service.
 * @param {string} type - The notification service type
 * @param {Object} options - Configuration options for the notification service
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {NotificationService} Notification service instance for messaging
 */
function createNotificationService(type, options, eventEmitter) {
  // Create notification service instance
  const notifying = new NotificationService(options, eventEmitter);
  
  // Initialize routes and views for the notification service
  Routes(options, eventEmitter, notifying);
  Views(options, eventEmitter, notifying);
  
  // Log service creation for debugging
  console.log('Notification service created with type:', type);
  
  return notifying;
}

module.exports = createNotificationService;