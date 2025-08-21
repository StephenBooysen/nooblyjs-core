/**
 * @fileoverview Notification service for managing topics and subscribers
 * with publish-subscribe pattern implementation and error handling.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * A class that implements a notification service with topic-based messaging.
 * Provides methods for creating topics, subscribing callbacks, and notifying subscribers.
 * @class
 */
class NotificationService {
  /**
   * Initializes the notification service with topic storage.
   * @param {Object=} options Configuration options for the service.
   * @param {EventEmitter=} eventEmitter Optional event emitter for notification events.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Map<string, !Set<Function>>} */
    this.topics = new Map();
    /** @private @const {Object} */
    this.options = options || {};
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Creates a new topic if it doesn't exist.
   * @param {string} topicName The name of the topic.
   * @return {Promise<void>} A promise that resolves when the topic is created.
   */
  async createTopic(topicName) {
    if (!this.topics.has(topicName)) {
      this.topics.set(topicName, new Set());
      if (this.eventEmitter_)
        this.eventEmitter_.emit('notification:createTopic', { topicName });
    }
  }

  /**
   * Subscribes a callback function to a topic.
   * @param {string} topicName The name of the topic.
   * @param {!Function} callback The callback function to be called when a message is published to the topic.
   * @return {Promise<void>} A promise that resolves when the subscription is complete.
   */
  async subscribe(topicName, callback) {
    if (!this.topics.has(topicName)) {
      this.createTopic(topicName);
    }
    this.topics.get(topicName).add(callback);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('notification:subscribe', { topicName });
  }

  /**
   * Unsubscribes a callback function from a topic.
   * @param {string} topicName The name of the topic.
   * @param {!Function} callback The callback function to unsubscribe.
   * @return {boolean} True if the callback was unsubscribed, false otherwise.
   */
  unsubscribe(topicName, callback) {
    if (this.topics.has(topicName)) {
      const unsubscribed = this.topics.get(topicName).delete(callback);
      if (unsubscribed && this.eventEmitter_)
        this.eventEmitter_.emit('notification:unsubscribe', { topicName });
      return unsubscribed;
    }
    return false;
  }

  /**
   * Notifies all subscribers of a topic with a given message.
   * @param {string} topicName The name of the topic.
   * @param {*} message The message to send to subscribers.
   * @return {Promise<void>} A promise that resolves when all subscribers are notified.
   */
  async notify(topicName, message) {
    if (this.topics.has(topicName)) {
      this.topics.get(topicName).forEach((callback) => {
        try {
          callback(message);
          if (this.eventEmitter_)
            this.eventEmitter_.emit('notification:notify', {
              topicName,
              message,
            });
        } catch (error) {
          console.error(
            `Error in notification callback for topic ${topicName}:`,
            error,
          );
          if (this.eventEmitter_)
            this.eventEmitter_.emit('notification:notify:error', {
              topicName,
              message,
              error: error.message,
            });
        }
      });
    }
  }
}

module.exports = NotificationService;