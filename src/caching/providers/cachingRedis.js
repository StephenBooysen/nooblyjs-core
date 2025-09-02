/**
 * @fileoverview A Redis-backed cache implementation providing distributed caching
 * functionality with analytics tracking for cache operations.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const Redis = require('ioredis');

/**
 * A class that implements a Redis-backed cache with analytics tracking.
 * Provides distributed caching using Redis as the backend store.
 * @class
 */
class CacheRedis {
  /**
   * Initializes the Redis client with connection options and analytics.
   * @param {Object=} options The connection options for the Redis client.
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events.
   * @throws {Error} When Redis connection fails.
   */
  constructor(options, eventEmitter) {
    const defaultOptions = {
      port: 6379,
      host: '127.0.0.1',
      family: 4,
      keepAlive: true,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxmemoryPolicy: 'noeviction',
      connectTimeout: 10000,
      commandTimeout: 5000,
      poolSize: 10,
      keyPrefix: '',
      ...options
    };

    /** @private @const {!Redis} */
    this.client_ = new Redis({
      ...defaultOptions,
      // Connection pooling configuration
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      // Pool management
      poolSize: defaultOptions.poolSize,
      // Connection lifecycle
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      }
    });

    this.eventEmitter_ = eventEmitter;
    /** @private @const {!Map<string, {key: string, hits: number, lastHit: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;
    
    this.setupConnectionHandlers_();
  }

  /**
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   * @param {number=} ttl Optional time-to-live in seconds.
   * @return {!Promise<void>}
   */
  async put(key, value, ttl) {
    await this.ensureConnection_();
    if (ttl) {
      await this.client_.setex(key, ttl, value);
    } else {
      await this.client_.set(key, value);
    }
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:put', { key, value, ttl });
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {!Promise<*|null>}
   */
  async get(key) {
    await this.ensureConnection_();
    const value = await this.client_.get(key);
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:get', { key, value });
    return value;
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {!Promise<void>}
   */
  async delete(key) {
    await this.ensureConnection_();
    await this.client_.del(key);
    if (this.eventEmitter_) this.eventEmitter_.emit('cache:delete', { key });
  }

  /**
   * Gets analytics data for cache operations.
   * @return {Array<{key: string, hits: number, lastHit: string}>} Analytics data.
   */
  getAnalytics() {
    const analytics = Array.from(this.analytics_.values());
    return analytics.map((entry) => ({
      key: entry.key,
      hits: entry.hits,
      lastHit: entry.lastHit.toISOString(),
    }));
  }

  /**
   * Tracks a cache operation for analytics.
   * @param {string} key The cache key being accessed.
   * @private
   */
  trackOperation_(key) {
    const now = new Date();

    if (this.analytics_.has(key)) {
      // Update existing entry
      const entry = this.analytics_.get(key);
      entry.hits++;
      entry.lastHit = now;
    } else {
      // Add new entry
      const entry = {
        key: key,
        hits: 1,
        lastHit: now,
      };

      // If we're at capacity, remove the least recently used entry
      if (this.analytics_.size >= this.maxAnalyticsEntries_) {
        this.removeLeastRecentlyUsed_();
      }

      this.analytics_.set(key, entry);
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
      if (!oldestTime || entry.lastHit < oldestTime) {
        oldestTime = entry.lastHit;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.analytics_.delete(oldestKey);
    }
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
   * @return {{status: string, poolSize: number, connectedClients: number}}
   */
  getConnectionInfo() {
    return {
      status: this.client_.status,
      poolSize: this.client_.options.poolSize || 1,
      connectedClients: this.client_.connector ? 1 : 0
    };
  }
}

module.exports = CacheRedis;
