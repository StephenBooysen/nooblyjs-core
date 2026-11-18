/**
 * @fileoverview A Redis-backed queue implementation providing distributed queue
 * functionality with FIFO (First-In-First-Out) behavior and analytics tracking.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const Redis = require('ioredis');

/**
 * A class that implements a Redis-backed queue with FIFO behavior and analytics tracking.
 * Provides distributed queue using Redis as the backend store with support for multiple named queues.
 * Uses Redis List data structure (LPUSH/RPOP) for efficient FIFO operations.
 * @class
 */
class QueueingRedis {
  /**
   * Initializes the Redis client with connection options and analytics.
   * @param {Object=} options The connection options for the Redis client.
   * @param {string=} options.redisdurl The Redis host/URL (default: '127.0.0.1')
   * @param {number=} options.redisport The Redis port (default: 6379)
   * @param {string=} options.instanceName The instance name for this queue (default: 'default')
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events.
   * @throws {Error} When Redis connection fails.
   */
  constructor(options, eventEmitter) {
    this.settings = {};
    this.settings.description = 'Redis settings for distributed queue operations';
    this.settings.list = [
      { setting: 'redisurl', type: 'string', values: ['127.0.0.1'] },
      { setting: 'redisport', type: 'number', values: [6379] }
    ];

    this.settings.redisurl = options?.redisurl || options?.redisdurl || '127.0.0.1';
    this.settings.redisport = options?.redisport || 6379;

    const defaultOptions = {
      port: this.settings.redisport,
      host: this.settings.redisurl,
      family: 4,
      keepAlive: true,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
      poolSize: 10,
      keyPrefix: 'queue:',
      ...options
    };

    /** @private @const {!Redis} */
    this.client_ = new Redis({
      ...defaultOptions,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      poolSize: defaultOptions.poolSize,
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      }
    });

    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';

    /** @private @const {!Map<string, {queueName: string, operations: number, lastActivity: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;

    this.setupConnectionHandlers_();
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
          newValue: settings[this.settings.list[i].setting]
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
   * Adds an item to the end of the specified queue (enqueue operation).
   * Uses Redis LPUSH to push to the left (end) of the list.
   * @param {string} queueName The name of the queue.
   * @param {*} item The item to add to the queue.
   * @return {Promise<void>} A promise that resolves when the item is enqueued.
   */
  async enqueue(queueName, item) {
    this.validateQueueName_(queueName, 'enqueue');
    await this.ensureConnection_();
    const itemStr = typeof item === 'string' ? item : JSON.stringify(item);
    try {
      await this.client_.lpush(queueName, itemStr);
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
   * Removes and returns the item at the front of the specified queue (dequeue operation).
   * Uses Redis RPOP to pop from the right (front) of the list.
   * @param {string} queueName The name of the queue.
   * @return {Promise<*>} A promise that resolves to the item at the front of the queue, or undefined if empty.
   */
  async dequeue(queueName) {
    this.validateQueueName_(queueName, 'dequeue');
    await this.ensureConnection_();
    try {
      const itemStr = await this.client_.rpop(queueName);
      if (itemStr) {
        this.trackOperation_(queueName);
        const item = (() => {
          try {
            return JSON.parse(itemStr);
          } catch {
            return itemStr;
          }
        })();

        if (this.eventEmitter_) {
          const eventName = `queue:dequeue:${this.instanceName_}`;
          this.eventEmitter_.emit(eventName, { queueName, item });
        }
        return item;
      }
      return undefined;
    } catch (err) {
      throw new Error(`Failed to dequeue item from queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns the number of items in the specified queue.
   * Uses Redis LLEN to get the length of the list.
   * @param {string} queueName The name of the queue.
   * @return {Promise<number>} A promise that resolves to the number of items in the queue.
   */
  async size(queueName) {
    this.validateQueueName_(queueName, 'size');
    await this.ensureConnection_();
    try {
      const length = await this.client_.llen(queueName);
      return length || 0;
    } catch (err) {
      throw new Error(`Failed to get size of queue "${queueName}": ${err.message}`);
    }
  }

  /**
   * Returns a list of all queue names.
   * Scans Redis keys with the queue: prefix.
   * @return {Promise<Array<string>>} A promise that resolves to an array of queue names.
   */
  async listQueues() {
    await this.ensureConnection_();
    try {
      const pattern = 'queue:*';
      const keys = await this.client_.keys(pattern);
      // Remove the 'queue:' prefix from keys
      return keys.map(key => key.replace(/^queue:/, ''));
    } catch (err) {
      throw new Error(`Failed to list queues: ${err.message}`);
    }
  }

  /**
   * Purges all items from the specified queue.
   * Uses Redis DEL to delete the queue key.
   * @param {string} queueName The name of the queue to purge.
   * @return {Promise<void>} A promise that resolves when the queue is purged.
   */
  async purge(queueName) {
    this.validateQueueName_(queueName, 'purge');
    await this.ensureConnection_();
    try {
      await this.client_.del(queueName);
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
   * Sets up connection event handlers for the Redis client.
   * @private
   */
  setupConnectionHandlers_() {
    this.client_.on('connect', () => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('redis:connect');
      }
    });

    this.client_.on('ready', () => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('redis:ready');
      }
    });

    this.client_.on('error', (err) => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('redis:error', err);
      }
    });

    this.client_.on('close', () => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('redis:close');
      }
    });

    this.client_.on('reconnecting', () => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('redis:reconnecting');
      }
    });

    this.client_.on('end', () => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('redis:end');
      }
    });
  }

  /**
   * Ensures the Redis connection is established.
   * @return {!Promise<void>}
   * @private
   */
  async ensureConnection_() {
    if (this.client_.status !== 'ready') {
      await this.client_.connect();
    }
  }

  /**
   * Gracefully closes the Redis connection and cleans up resources.
   * @return {!Promise<void>}
   */
  async disconnect() {
    try {
      await this.client_.quit();
    } catch (err) {
      await this.client_.disconnect();
    }
  }

  /**
   * Gets connection status information.
   * @return {{status: string, poolSize: number, host: string, port: number}}
   */
  getConnectionInfo() {
    return {
      status: this.client_.status,
      poolSize: this.client_.options.poolSize || 1,
      host: this.client_.options.host,
      port: this.client_.options.port
    };
  }
}

module.exports = QueueingRedis;
