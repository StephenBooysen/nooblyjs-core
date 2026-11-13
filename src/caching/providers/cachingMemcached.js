/**
 * @fileoverview A Memcached-backed cache implementation providing distributed caching
 * functionality with TTL support and analytics tracking for cache operations.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { loadOptionalModule } = require('../../shared/utils/optionalRequire');

/**
 * A class that implements a Memcached-backed cache with analytics tracking.
 * Provides distributed caching using Memcached as the backend store with TTL support.
 * @class
 */
class CacheMemcached {
  /**
   * Initializes the Memcached client with connection options and analytics.
   * @param {Object} options The connection options for the Memcached client.
   * @param {string} options.memcachedurl The Memcached connection URL.
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events.
   * @throws {Error} When Memcached connection URL is not provided.
   */
  constructor(options, eventEmitter) {
  
    this.settings = {};
    this.settings.description = "The following settings are needed for this provider"
    this.settings.list = [
      {setting: "memcachedurl", type: "string", values : ['localhost:11211']}
    ];
    this.settings.memcachedurl = options.memcachedurl || this.settings.memcachedurl || 'localhost:11211';

    const defaultOptions = {
      poolSize: 10,
      timeout: 5000,
      retries: 3,
      failover: true,
      keepAlive: true,
      reconnect: true,
      idle: 30000,
      maxExpiration: 2592000,
      ...options
    };

    /** @private @const {!Client} */
    const { Client } = loadOptionalModule('memjs', 'Memcached caching');
    this.client_ = Client.create(this.settings.memcachedurl, {
      poolSize: defaultOptions.poolSize,
      timeout: defaultOptions.timeout,
      retries: defaultOptions.retries,
      failover: defaultOptions.failover,
      keepAlive: defaultOptions.keepAlive,
      reconnect: defaultOptions.reconnect,
      idle: defaultOptions.idle,
      maxExpiration: defaultOptions.maxExpiration
    });

    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';
    this.options_ = defaultOptions;
    this.isConnected_ = false;
    this.connectionAttempts_ = 0;
    this.maxConnectionAttempts_ = 5;

    this.analytics_ = new Map();
    this.maxAnalyticsEntries_ = 100;

    this.setupConnectionHandlers_();
  }

  /**
   * Get all our settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings){
    for (let i=0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting]
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('cache:setting-changed', {
            setting: this.settings.list[i].setting,
            value: settings[this.settings.list[i].setting]
          });
        }
      }
    }
  }

  /**
   * Validates that a cache key is a non-empty string.
   * @param {string} key The key to validate.
   * @param {string} method The calling method name for error context.
   * @throws {Error} When key is invalid.
   * @private
   */
  validateKey_(key, method) {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      const error = new Error('Invalid key: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`cache:validation-error:${this.instanceName_}`, {
          method,
          error: error.message,
          key
        });
      }
      throw error;
    }
  }

  /**
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   * @param {number=} ttl Optional time-to-live in seconds.
   * @return {!Promise<void>}
   * @throws {Error} When key is invalid or value is undefined.
   */
  async put(key, value, ttl) {
    this.validateKey_(key, 'put');
    if (value === undefined) {
      throw new Error('Invalid value: cannot be undefined');
    }
    await this.ensureConnection_();
    try {
      // Memcached stores values as strings, so we need to stringify objects.
      const stringValue =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      await this.client_.set(key, stringValue, { expires: ttl || 0 });
      this.trackOperation_(key);
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`cache:put:${this.instanceName_}`, { key, value, ttl, instance: this.instanceName_ });
    } catch (error) {
      this.handleConnectionError_(error);
      throw error;
    }
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {!Promise<*|null>}
   */
  async get(key) {
    this.validateKey_(key, 'get');
    await this.ensureConnection_();
    try {
      const { value } = await this.client_.get(key);
      this.trackOperation_(key);
      if (value === null) {
        if (this.eventEmitter_)
          this.eventEmitter_.emit(`cache:get:${this.instanceName_}`, { key, value: null, instance: this.instanceName_ });
        return null;
      }
      // Attempt to parse as JSON, otherwise return as string.
      try {
        const parsedValue = JSON.parse(value.toString());
        if (this.eventEmitter_)
          this.eventEmitter_.emit(`cache:get:${this.instanceName_}`, { key, value: parsedValue, instance: this.instanceName_ });
        return parsedValue;
      } catch (e) {
        const stringValue = value.toString();
        if (this.eventEmitter_)
          this.eventEmitter_.emit(`cache:get:${this.instanceName_}`, { key, value: stringValue, instance: this.instanceName_ });
        return stringValue;
      }
    } catch (error) {
      this.handleConnectionError_(error);
      throw error;
    }
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {!Promise<void>}
   */
  async delete(key) {
    this.validateKey_(key, 'delete');
    await this.ensureConnection_();
    try {
      await this.client_.delete(key);
      this.trackOperation_(key);
      if (this.eventEmitter_) this.eventEmitter_.emit(`cache:delete:${this.instanceName_}`, { key, instance: this.instanceName_ });
    } catch (error) {
      this.handleConnectionError_(error);
      throw error;
    }
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
   * Sets up connection event handlers for the Memcached client.
   * @private
   */
  setupConnectionHandlers_() {
    // Note: memjs doesn't expose connection events like ioredis
    // We'll implement connection tracking through operation success/failure
    this.isConnected_ = true;
  }

  /**
   * Ensures the Memcached connection is established and healthy.
   * @return {!Promise<void>}
   * @private
   */
  async ensureConnection_() {
    if (!this.isConnected_ && this.connectionAttempts_ < this.maxConnectionAttempts_) {
      try {
        await this.ping();
        this.isConnected_ = true;
        this.connectionAttempts_ = 0;
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('memcached:reconnected');
        }
      } catch (error) {
        this.connectionAttempts_++;
        this.isConnected_ = false;
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('memcached:connection_error', { 
            error, 
            attempts: this.connectionAttempts_ 
          });
        }
        if (this.connectionAttempts_ >= this.maxConnectionAttempts_) {
          throw new Error(`Failed to connect to Memcached after ${this.maxConnectionAttempts_} attempts`);
        }
      }
    }
  }

  /**
   * Handles connection errors and updates connection state.
   * @param {Error} error The connection error.
   * @private
   */
  handleConnectionError_(error) {
    this.isConnected_ = false;
    if (this.eventEmitter_) {
      this.eventEmitter_.emit('memcached:error', error);
    }
  }

  /**
   * Gracefully closes the Memcached connection and cleans up resources.
   * @return {!Promise<void>}
   */
  async disconnect() {
    try {
      if (this.client_ && this.client_.close) {
        this.client_.close();
      }
      this.isConnected_ = false;
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('memcached:disconnected');
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('memcached:disconnect_error', error);
      }
    }
  }

  /**
   * Gets connection status information.
   * @return {{status: string, poolSize: number, isConnected: boolean, connectionAttempts: number}}
   */
  getConnectionInfo() {
    return {
      status: this.isConnected_ ? 'connected' : 'disconnected',
      poolSize: this.options_.poolSize,
      isConnected: this.isConnected_,
      connectionAttempts: this.connectionAttempts_
    };
  }

  /**
   * Performs a health check by attempting to retrieve server statistics.
   * @return {!Promise<boolean>} True if the connection is healthy, false otherwise.
   */
  async ping() {
    try {
      await this.client_.stats();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Gets Memcached server statistics for monitoring and debugging.
   * @return {!Promise<Object|null>} Server statistics or null if unavailable.
   */
  async getStats() {
    try {
      const stats = await this.client_.stats();
      return stats;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('memcached:stats_error', error);
      }
      return null;
    }
  }

  /**
   * Performs a comprehensive health check of the Memcached connection.
   * @return {!Promise<{healthy: boolean, latency: number, error?: string}>}
   */
  async healthCheck() {
    const startTime = Date.now();
    try {
      await this.ping();
      const latency = Date.now() - startTime;
      return {
        healthy: true,
        latency: latency,
        poolSize: this.options_.poolSize,
        isConnected: this.isConnected_
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        healthy: false,
        latency: latency,
        poolSize: this.options_.poolSize,
        isConnected: this.isConnected_,
        error: error.message
      };
    }
  }

  /**
   * Flushes all data from the Memcached server.
   * USE WITH CAUTION: This will delete all cached data.
   * @return {!Promise<void>}
   */
  async flush() {
    await this.ensureConnection_();
    try {
      await this.client_.flush();
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('memcached:flushed');
      }
    } catch (error) {
      this.handleConnectionError_(error);
      throw error;
    }
  }
}

module.exports = CacheMemcached;
