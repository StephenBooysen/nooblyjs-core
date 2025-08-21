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
    /** @private @const {!Object<string, *>} */
    this.cache_ = {};
    this.eventEmitter_ = eventEmitter;
    /** @private @const {!Map<string, {key: string, hits: number, lastHit: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = 100;
  }

  /**
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   * @return {Promise<void>} A promise that resolves when the value is stored.
   */
  async put(key, value) {
    this.cache_[key] = value;
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:put', { key, value });
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {Promise<*>} A promise that resolves to the cached value, or undefined if not found.
   */
  async get(key) {
    const value = this.cache_[key];
    this.trackOperation_(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:get', { key, value });
    return value;
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {Promise<void>} A promise that resolves when the key is deleted.
   */
  async delete(key) {
    delete this.cache_[key];
    if (this.eventEmitter_) this.eventEmitter_.emit('cache:delete', { key });
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
