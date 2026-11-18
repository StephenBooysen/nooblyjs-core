/**
 * @fileoverview An in-memory queue implementation providing FIFO data structure
 * with enqueue and dequeue operations and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * A class that implements an in-memory queue with FIFO behavior.
 * Supports multiple named queues for organizing different types of tasks.
 * Provides methods for enqueueing, dequeueing, and checking queue size.
 * @class
 */
class Queueing {
  /**
   * Initializes the in-memory queue with empty storage.
   * @param {Object=} options Configuration options (unused in this implementation).
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events.
   */
  constructor(options, eventEmitter) {
    this.settings = {
      description: 'There are no settings defined for the in memory queue',
      list: []
    };

    this.queues_ = new Map();
    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';
  }

  /**
   * Get all our settings
   * @returns {Promise<Object>} The current settings object.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Set all our settings
   * @param {Object} settings The new settings to save.
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    for (const { setting } of this.settings.list) {
      if (settings[setting] != null) {
        this.settings[setting] = settings[setting];
      }
    }
  }

  /**
   * Gets or creates a queue with the specified name.
   * @private
   * @param {string} queueName The name of the queue.
   * @return {!Array<*>} The queue array.
   */
  getQueue_(queueName) {
    if (!this.queues_.has(queueName)) {
      this.queues_.set(queueName, []);
    }
    return this.queues_.get(queueName);
  }

  /**
   * Adds an item to the end of the specified queue (enqueue operation).
   * @param {string} queueName The name of the queue.
   * @param {*} item The item to add to the queue.
   * @return {Promise<void>} A promise that resolves when the item is enqueued.
   * @throws {Error} When queueName is invalid or item is undefined.
   */
  async enqueue(queueName, item) {
    // Validate queueName parameter
    if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
      const error = new Error('Invalid queueName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method: 'enqueue',
          error: error.message,
          queueName
        });
      }
      throw error;
    }

    // Validate item parameter
    if (item === undefined) {
      const error = new Error('Invalid item: cannot be undefined');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method: 'enqueue',
          error: error.message,
          queueName
        });
      }
      throw error;
    }

    const queue = this.getQueue_(queueName);
    queue.push(item);
    if (this.eventEmitter_) {
      const eventName = `queue:enqueue:${this.instanceName_}`;
      this.eventEmitter_.emit(eventName, { queueName, item });
    }
  }

  /**
   * Removes and returns the item at the front of the specified queue (dequeue operation).
   * @param {string} queueName The name of the queue.
   * @return {Promise<*>} A promise that resolves to the item at the front of the queue, or undefined if empty.
   * @throws {Error} When queueName is invalid.
   */
  async dequeue(queueName) {
    // Validate queueName parameter
    if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
      const error = new Error('Invalid queueName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method: 'dequeue',
          error: error.message,
          queueName
        });
      }
      throw error;
    }

    const queue = this.getQueue_(queueName);
    const item = queue.shift();
    if (item && this.eventEmitter_) {
      const eventName = `queue:dequeue:${this.instanceName_}`;
      this.eventEmitter_.emit(eventName, { queueName, item });
    }
    return item;
  }

  /**
   * Returns the number of items in the specified queue.
   * @param {string} queueName The name of the queue.
   * @return {Promise<number>} A promise that resolves to the number of items in the queue.
   * @throws {Error} When queueName is invalid.
   */
  async size(queueName) {
    // Validate queueName parameter
    if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
      const error = new Error('Invalid queueName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method: 'size',
          error: error.message,
          queueName
        });
      }
      throw error;
    }

    const queue = this.getQueue_(queueName);
    return queue.length;
  }

  /**
   * Returns a list of all queue names.
   * @return {Promise<Array<string>>} A promise that resolves to an array of queue names.
   */
  async listQueues() {
    return Array.from(this.queues_.keys());
  }

  /**
   * Purges all items from the specified queue.
   * @param {string} queueName The name of the queue to purge.
   * @return {Promise<void>} A promise that resolves when the queue is purged.
   * @throws {Error} When queueName is invalid.
   */
  async purge(queueName) {
    // Validate queueName parameter
    if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
      const error = new Error('Invalid queueName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method: 'purge',
          error: error.message,
          queueName
        });
      }
      throw error;
    }

    this.queues_.set(queueName, []);
    if (this.eventEmitter_) {
      const eventName = `queue:purge:${this.instanceName_}`;
      this.eventEmitter_.emit(eventName, { queueName });
    }
  }
}

module.exports = Queueing;
