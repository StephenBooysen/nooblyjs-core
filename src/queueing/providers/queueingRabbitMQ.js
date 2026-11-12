/**
 * @fileoverview A RabbitMQ-backed queue implementation providing distributed queue
 * functionality with FIFO (First-In-First-Out) behavior and analytics tracking.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

// Lazy load amqplib only when needed (when RabbitMQ provider is instantiated)
let amqp;

/**
 * A class that implements a RabbitMQ-backed queue with FIFO behavior and analytics tracking.
 * Provides distributed queue using RabbitMQ as the backend with support for multiple named queues.
 * Uses RabbitMQ durable queues with persistent message delivery.
 * @class
 */
class QueueingRabbitMQ {
  /**
   * Initializes the RabbitMQ connection with configuration options and analytics.
   * @param {Object=} options The connection options for RabbitMQ.
   * @param {string=} options.rabbitmqUrl The RabbitMQ connection URL (default: 'amqp://localhost')
   * @param {string=} options.instanceName The instance name for this queue (default: 'default')
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events.
   * @throws {Error} When RabbitMQ connection fails.
   */
  constructor(options, eventEmitter) {
    this.settings = {};
    this.settings.description = 'RabbitMQ settings for distributed queue operations';
    this.settings.list = [
      { setting: 'rabbitmqUrl', type: 'string', values: ['amqp://localhost'] }
    ];

    this.settings.rabbitmqUrl = options?.rabbitmqUrl || 'amqp://localhost';

    /** @private {Object} RabbitMQ connection */
    this.connection_ = null;

    /** @private {Object} RabbitMQ channel */
    this.channel_ = null;

    /** @private {boolean} Connection status */
    this.connected_ = false;

    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';

    /** @private @const {!Map<string, {queueName: string, operations: number, lastActivity: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;
  }

  /**
   * Get all our settings
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting],
          operation: 'saveSettings'
        });
      }
    }
  }

  /**
   * Validates that a queue name is a non-empty string.
   * @param {string} queueName The queue name to validate.
   * @param {string} method The calling method name for error context.
   * @throws {Error} When queue name is invalid.
   * @private
   */
  validateQueueName_(queueName, method) {
    if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
      const error = new Error('Invalid queue name: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method,
          error: error.message,
          queueName
        });
      }
      throw error;
    }
  }

  /**
   * Adds an item to the specified queue (enqueue operation).
   * @param {string} queueName The name of the queue.
   * @param {*} item The item to add to the queue.
   * @return {Promise<void>} A promise that resolves when the item is enqueued.
   */
  async enqueue(queueName, item) {
    this.validateQueueName_(queueName, 'enqueue');
    await this.ensureConnection_();
    const itemStr = typeof item === 'string' ? item : JSON.stringify(item);
    try {
      // Assert queue exists and is durable
      await this.channel_.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 3600000 // 1 hour TTL
        }
      });

      // Send message to queue
      const sent = this.channel_.sendToQueue(queueName, Buffer.from(itemStr), {
        persistent: true,
        contentType: 'application/json'
      });

      if (!sent) {
        throw new Error('Failed to send message to queue');
      }

      this.trackOperation_(queueName);
      if (this.eventEmitter_) {
        const eventName = `queue:enqueue:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { queueName, item });
      }
    } catch (err) {
      throw new Error(`Failed to enqueue item to queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Removes and returns the item from the front of the specified queue (dequeue operation).
   * @param {string} queueName The name of the queue.
   * @param {Object=} _options Optional options for dequeue behavior (reserved for future use)
   * @return {Promise<*>} A promise that resolves to the item from the queue, or undefined if empty.
   */
  async dequeue(queueName, _options = {}) {
    this.validateQueueName_(queueName, 'dequeue');
    await this.ensureConnection_();
    try {
      // Assert queue exists
      await this.channel_.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 3600000
        }
      });

      // Get message from queue (no auto-ack for reliability)
      const message = await this.channel_.get(queueName, { noAck: false });

      // Track operation regardless of whether message exists
      this.trackOperation_(queueName);

      let item = undefined;

      if (message) {
        // Acknowledge the message (remove from queue)
        this.channel_.ack(message);

        const itemStr = message.content.toString();
        item = (() => {
          try {
            return JSON.parse(itemStr);
          } catch {
            return itemStr;
          }
        })();
      }

      // Emit event for ALL dequeue attempts (even if queue is empty)
      if (this.eventEmitter_) {
        const eventName = `queue:dequeue:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { queueName, item });
      }

      return item;
    } catch (err) {
      throw new Error(`Failed to dequeue item from queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns the number of items in the specified queue.
   * @param {string} queueName The name of the queue.
   * @return {Promise<number>} A promise that resolves to the number of items in the queue.
   */
  async size(queueName) {
    this.validateQueueName_(queueName, 'size');
    await this.ensureConnection_();
    try {
      const queueInfo = await this.channel_.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 3600000
        }
      });
      return queueInfo.messageCount || 0;
    } catch (err) {
      throw new Error(`Failed to get size of queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns a list of all queue names.
   * Note: RabbitMQ doesn't provide a built-in list queues API, so we track created queues.
   * @return {Promise<Array<string>>} A promise that resolves to an array of queue names.
   */
  async listQueues() {
    await this.ensureConnection_();
    try {
      // Return queues from analytics (queues we've interacted with)
      const analyticsQueues = Array.from(this.analytics_.keys());
      return analyticsQueues;
    } catch (err) {
      throw new Error(`Failed to list queues: ${err.message}`);
    }
  }

  /**
   * Purges all items from the specified queue.
   * @param {string} queueName The name of the queue to purge.
   * @return {Promise<void>} A promise that resolves when the queue is purged.
   */
  async purge(queueName) {
    this.validateQueueName_(queueName, 'purge');
    await this.ensureConnection_();
    try {
      await this.channel_.purgeQueue(queueName);
      if (this.eventEmitter_) {
        const eventName = `queue:purge:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { queueName });
      }
    } catch (err) {
      throw new Error(`Failed to purge queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Tracks a queue operation for analytics.
   * @param {string} queueName The queue name being accessed.
   * @private
   */
  trackOperation_(queueName) {
    const now = new Date();

    if (this.analytics_.has(queueName)) {
      // Update existing entry
      const entry = this.analytics_.get(queueName);
      entry.operations++;
      entry.lastActivity = now;
    } else {
      // Add new entry
      const entry = {
        queueName: queueName,
        operations: 1,
        lastActivity: now
      };

      // If we're at capacity, remove the least recently used entry
      if (this.analytics_.size >= this.maxAnalyticsEntries_) {
        this.removeLeastRecentlyUsed_();
      }

      this.analytics_.set(queueName, entry);
    }
  }

  /**
   * Removes the least recently used entry from analytics.
   * @private
   */
  removeLeastRecentlyUsed_() {
    let oldestKey = null;
    let oldestTime = null;

    for (const [key, entry] of this.analytics_) {
      if (!oldestTime || entry.lastActivity < oldestTime) {
        oldestTime = entry.lastActivity;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.analytics_.delete(oldestKey);
    }
  }

  /**
   * Gets analytics data for queue operations.
   * @return {Array<{queueName: string, operations: number, lastActivity: string}>} Analytics data.
   */
  getAnalytics() {
    const analytics = Array.from(this.analytics_.values());
    return analytics.map((entry) => ({
      queueName: entry.queueName,
      operations: entry.operations,
      lastActivity: entry.lastActivity.toISOString()
    }));
  }

  /**
   * Ensures the RabbitMQ connection is established and channel is ready.
   * @return {!Promise<void>}
   * @private
   */
  async ensureConnection_() {
    if (this.connected_ && this.connection_ && this.channel_) {
      return;
    }

    try {
      // Lazy load amqplib only when first connection is needed
      if (!amqp) {
        amqp = requireOptional('amqplib', "queue('rabbitmq')");
      }

      // Connect to RabbitMQ
      this.connection_ = await amqp.connect(this.settings.rabbitmqUrl);

      // Setup connection error handling
      this.connection_.on('error', (err) => {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('rabbitmq:error', err);
        }
        this.connected_ = false;
      });

      this.connection_.on('close', () => {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('rabbitmq:close');
        }
        this.connected_ = false;
      });

      // Create channel
      this.channel_ = await this.connection_.createChannel();

      // Setup prefetch limit (process one message at a time)
      await this.channel_.prefetch(1);

      this.connected_ = true;

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('rabbitmq:ready');
      }
    } catch (err) {
      this.connected_ = false;
      throw new Error(`Failed to connect to RabbitMQ: ${err.message}`);
    }
  }

  /**
   * Gracefully closes the RabbitMQ connection and cleans up resources.
   * @return {!Promise<void>}
   */
  async disconnect() {
    try {
      if (this.channel_) {
        await this.channel_.close();
      }
      if (this.connection_) {
        await this.connection_.close();
      }
      this.connected_ = false;
    } catch (err) {
      this.logger?.error(`[${this.constructor.name}] Error disconnecting from RabbitMQ`, {
        error: err.message,
        stack: err.stack,
        operation: 'disconnect'
      });
    }
  }

  /**
   * Gets connection status information.
   * @return {{status: string, connected: boolean, url: string}}
   */
  getConnectionInfo() {
    return {
      status: this.connected_ ? 'connected' : 'disconnected',
      connected: this.connected_,
      url: this.settings.rabbitmqUrl
    };
  }
}

module.exports = QueueingRabbitMQ;
