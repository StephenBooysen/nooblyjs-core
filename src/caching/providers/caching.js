/**
 * @fileoverview A simple in-memory cache implementation providing basic caching
 * functionality with analytics tracking for cache operations.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * A class that implements a simple in-memory cache with analytics tracking.
 * Provides methods for storing, retrieving, and deleting cached values.
 * @class
 */
class Cache {
  /**
   * Initializes the cache with empty storage and analytics.
   * @param {Object=} options Configuration options (unused in this implementation).
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events.
   */
  constructor(options, eventEmitter) {
    this.settings = {
      description: 'There are no settings for this provider',
      list: []
    };

    this.cache_ = {};
    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';
    this.analytics_ = new Map();
    this.maxAnalyticsEntries_ = 100;
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
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   * @return {Promise<void>} A promise that resolves when the value is stored.
   * @throws {Error} When key is invalid or value is undefined.
   */
  async put(key, value) {
    // Validate key parameter
    if (!key || typeof key !== 'string' || key.trim() === '') {
      const error = new Error('Invalid key: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`cache:validation-error:${this.instanceName_}`, {
          method: 'put',
          error: error.message,
          key
        });
      }
      throw error;
    }

    // Validate value parameter
    if (value === undefined) {
      const error = new Error('Invalid value: cannot be undefined');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`cache:validation-error:${this.instanceName_}`, {
          method: 'put',
          error: error.message,
          key
        });
      }
      throw error;
    }

    this.cache_[key] = value;
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit(`cache:put:${this.instanceName_}`, { key, value, instance: this.instanceName_ });
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {Promise<*>} A promise that resolves to the cached value, or undefined if not found.
   * @throws {Error} When key is invalid.
   */
  async get(key) {
    // Validate key parameter
    if (!key || typeof key !== 'string' || key.trim() === '') {
      const error = new Error('Invalid key: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`cache:validation-error:${this.instanceName_}`, {
          method: 'get',
          error: error.message,
          key
        });
      }
      throw error;
    }

    const value = this.cache_[key];
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit(`cache:get:${this.instanceName_}`, { key, value, instance: this.instanceName_ });
    return value;
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {Promise<void>} A promise that resolves when the key is deleted.
   * @throws {Error} When key is invalid.
   */
  async delete(key) {
    // Validate key parameter
    if (!key || typeof key !== 'string' || key.trim() === '') {
      const error = new Error('Invalid key: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`cache:validation-error:${this.instanceName_}`, {
          method: 'delete',
          error: error.message,
          key
        });
      }
      throw error;
    }

    delete this.cache_[key];
    if (this.eventEmitter_) this.eventEmitter_.emit(`cache:delete:${this.instanceName_}`, { key, instance: this.instanceName_ });
  }

  /**
   * Gets analytics data for cache operations.
   * @return {Array<{key: string, hits: number, lastHit: string}>} Array of analytics data with key, hits, and last hit timestamp.
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
}

module.exports = Cache;
