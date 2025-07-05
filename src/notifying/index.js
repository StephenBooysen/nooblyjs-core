/**
 * @fileoverview Notification service for managing topics and subscribers.
 */
const NotificationService = require('./provider/notifying');
const Routes = require('./routes');

/**
 * Creates a NotificationService instance.
 * @param {string} type The type of notification service to return.
 * @param {Object} options The options to configure the notification service.
 * @param {EventEmitter=} eventEmitter Optional EventEmitter instance for event bubbling.
 * @return {!NotificationService} A NotificationService instance.
 */
function createNotificationService(type, options, eventEmitter) {
  let notifying = new NotificationService(options, eventEmitter)
  Routes(options, eventEmitter, notifying);
  console.log('Notification service created with type:', type);
  return notifying;
}

module.exports = createNotificationService;