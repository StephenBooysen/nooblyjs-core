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

    this.settings = {};
    this.settings.description = "The following settings are needed for this provider"
    this.settings.list = [
      {setting: "redisurl", type: "string", values : ['127.0.0.1']}
    ];
    this.settings.redisurl = options.redisurl || options.redisdurl || this.settings.redisurl || '127.0.0.1';

    const defaultOptions = {
      port: 6379,
      host: this.settings.redisurl,
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
    this.instanceName_ = (options && options.instanceName) || 'default';
    /** @private @const {!Map<string, {key: string, hits: number, lastHit: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
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
    const stored = CacheRedis.encode_(value);
    if (ttl) {
      await this.client_.setex(key, ttl, stored);
    } else {
      await this.client_.set(key, stored);
    }
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit(`cache:put:${this.instanceName_}`, { key, value, ttl, instance: this.instanceName_ });
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {!Promise<*|null>}
   */
  async get(key) {
    this.validateKey_(key, 'get');
    await this.ensureConnection_();
    const value = CacheRedis.decode_(await this.client_.get(key));
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit(`cache:get:${this.instanceName_}`, { key, value, instance: this.instanceName_ });
    return value;
  }

  /**
   * Turns a value into the string Redis stores. Strings are stored as they are.
   * Every other value (numbers, booleans, null, objects, arrays) is stored as
   * JSON behind a marker, so it reads back with its own type. A string that
   * happens to start with the marker is stored as JSON too, so it is not
   * mistaken for one.
   *
   * @param {*} value
   * @return {string}
   * @throws {TypeError} When the value has no JSON form (a function, say)
   * @private
   */
  static encode_(value) {
    if (typeof value === 'string' && !value.startsWith(CacheRedis.JSON_MARK_)) {
      return value;
    }
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new TypeError('Cannot cache a value that has no JSON form');
    }
    return `${CacheRedis.JSON_MARK_}${json}`;
  }

  /**
   * Reads a stored string back to the value that was put. Entries written by
   * earlier versions (objects and arrays stored as bare JSON) still decode.
   * Any other string comes back unchanged.
   *
   * @param {?string} raw The stored value.
   * @return {*} The decoded value.
   * @private
   */
  static decode_(raw) {
    if (typeof raw !== 'string') {
      return raw;
    }
    const isMarked = raw.startsWith(CacheRedis.JSON_MARK_);
    if (!isMarked && !/^\s*[[{]/.test(raw)) {
      return raw;
    }
    try {
      return JSON.parse(isMarked ? raw.slice(CacheRedis.JSON_MARK_.length) : raw);
    } catch (error) {
      return raw;
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
    await this.client_.del(key);
    if (this.eventEmitter_) this.eventEmitter_.emit(`cache:delete:${this.instanceName_}`, { key, instance: this.instanceName_ });
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

/** Marks a value stored as JSON (see encode_). \u0001 cannot start normal text. */
CacheRedis.JSON_MARK_ = '\u0001json:';

module.exports = CacheRedis;
