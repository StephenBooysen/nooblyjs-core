/**
 * @fileoverview Notification service for managing topics and subscribers.
 */

class NotificationService {

  constructor(options, eventEmitter) {
    this.topics = new Map();
    this.options = options || {};
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Creates a new topic if it doesn't exist.
   * @param {string} topicName - The name of the topic.
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
   * @param {string} topicName - The name of the topic.
   * @param {function} callback - The callback function to be called when a message is published to the topic.
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
   * @param {string} topicName - The name of the topic.
   * @param {function} callback - The callback function to unsubscribe.
   * @returns {boolean} - True if the callback was unsubscribed, false otherwise.
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
   * @param {string} topicName - The name of the topic.
   * @param {*} message - The message to send to subscribers.
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