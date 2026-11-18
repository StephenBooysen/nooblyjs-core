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
    /** @private @const {string} */
    this.instanceName_ = (options && options.instanceName) || 'default';

    // Initialize logger from dependencies
    const { dependencies = {} } = this.options;
    /** @private */
    this.logger = dependencies.logging || null;

    /** @private {!Array<Object>} Recent published notifications, oldest first. */
    this.notificationHistory_ = [];
    /** @private {number} Running counter used to build unique notification ids. */
    this.notificationCounter_ = 0;
    /** @private {number} Maximum notifications retained in the history buffer. */
    this.maxNotificationHistory_ = (options && options.maxNotificationHistory) || 500;

    // Settings configuration
    this.settings = {};
    this.settings.description = "Configuration settings for the notifying service";
    this.settings.list = [
      { setting: 'maxSubscribers', type: 'number', values: null },
      { setting: 'messageTimeout', type: 'number', values: null },
      { setting: 'enableQueuing', type: 'boolean', values: null }
    ];
    this.settings.maxSubscribers = options.maxSubscribers || 100;
    this.settings.messageTimeout = options.messageTimeout || 5000;
    this.settings.enableQueuing = options.enableQueuing !== undefined ? options.enableQueuing : false;
  }

  /**
   * Creates a new topic if it doesn't exist.
   * @param {string} topicName The name of the topic.
   * @return {Promise<void>} A promise that resolves when the topic is created.
   */
  async createTopic(topicName) {
    if (!this.topics.has(topicName)) {
      this.topics.set(topicName, new Set());
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`notification:createTopic:${this.instanceName_}`, { topicName });
      }
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
      await this.createTopic(topicName);
    }
    // Enforce maxSubscribers limit
    const subscribers = this.topics.get(topicName);
    if (this.settings.maxSubscribers && subscribers.size >= this.settings.maxSubscribers) {
      this.logger?.warn(`[${this.constructor.name}] Max subscribers (${this.settings.maxSubscribers}) reached for topic: ${topicName}`);
      throw new Error(`Max subscribers (${this.settings.maxSubscribers}) reached for topic: ${topicName}`);
    }
    subscribers.add(callback);
    if (this.eventEmitter_) {
      this.eventEmitter_.emit(`notification:subscribe:${this.instanceName_}`, { topicName });
    }
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
      if (unsubscribed && this.eventEmitter_) {
        this.eventEmitter_.emit(`notification:unsubscribe:${this.instanceName_}`, { topicName });
      }
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
    // Record every published message so it can be surfaced in the inbox UI,
    // independently of whether the topic currently has subscribers.
    this.storeNotification_(topicName, message);

    if (this.topics.has(topicName)) {
      this.topics.get(topicName).forEach((callback) => {
        try {
          callback(message);
          if (this.eventEmitter_) {
            this.eventEmitter_.emit(`notification:notify:${this.instanceName_}`, {
              topicName,
              message,
            });
          }
        } catch (error) {
          // Silently handle callback error and emit event
          this.logger?.error(`[${this.constructor.name}] Error in notification callback`, {
            topicName,
            error: error.message
          });
          if (this.eventEmitter_) {
            this.eventEmitter_.emit(`notification:notify:error:${this.instanceName_}`, {
              topicName,
              message,
              error: error.message,
            });
          }
        }
      });
    }
  }

  /**
   * Records a published notification in the in-memory history buffer.
   * The message is stored as text so the inbox UI can render a preview;
   * non-string messages are JSON-serialised. The buffer is capped at
   * maxNotificationHistory_ entries (oldest dropped first).
   *
   * @param {string} topicName The topic the message was published to.
   * @param {*} message The published message.
   * @private
   */
  storeNotification_(topicName, message) {
    this.notificationCounter_ += 1;
    const text = typeof message === 'string' ? message : JSON.stringify(message);

    this.notificationHistory_.push({
      id: `ntf_${Date.now()}_${this.notificationCounter_}`,
      topic: topicName,
      message: text,
      timestamp: Date.now(),
      read: false,
    });

    if (this.notificationHistory_.length > this.maxNotificationHistory_) {
      this.notificationHistory_.splice(
        0,
        this.notificationHistory_.length - this.maxNotificationHistory_,
      );
    }
  }

  /**
   * Returns the recorded notification history, newest first.
   *
   * @return {!Array<Object>} Array of notification records
   *     ({id, topic, message, timestamp, read}).
   */
  getNotifications() {
    return [...this.notificationHistory_].reverse();
  }

  /**
   * Get all settings for the notifying service.
   * @return {Promise<Object>} A promise that resolves to the settings object.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Save settings for the notifying service.
   * @param {Object} settings The settings to save.
   * @return {Promise<void>} A promise that resolves when settings are saved.
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${this.settings.list[i].setting}`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting]
        });
      }
    }
  }
}

module.exports = NotificationService;