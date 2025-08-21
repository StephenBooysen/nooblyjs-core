/**
 * @fileoverview A Memcached-backed cache implementation.
 */

const { Client } = require('memjs');

/**
 * A class that implements a Memcached-backed cache.
 */
class CacheMemcached {
  /**
   * Initializes the Memcached client.
   * @param {Object=} options The connection options for the Memcached client.
   * @param {string} options.url The Memcached connection URL.
   */
  constructor(options, eventEmitter) {
    if (!options || !options.url) {
      throw new Error('Memcached connection URL is required.');
    }
    /** @private @const {!Client} */
    this.client_ = Client.create(options.url);
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
   * @param {number=} ttl Optional time-to-live in seconds.
   * @return {!Promise<void>}
   */
  async put(key, value, ttl) {
    // Memcached stores values as strings, so we need to stringify objects.
    const stringValue =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    await this.client_.set(key, stringValue, { expires: ttl || 0 });
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
    const { value } = await this.client_.get(key);
    this.trackOperation_(key);
    if (value === null) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:get', { key, value: null });
      return null;
    }
    // Attempt to parse as JSON, otherwise return as string.
    try {
      const parsedValue = JSON.parse(value.toString());
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:get', { key, value: parsedValue });
      return parsedValue;
    } catch (e) {
      const stringValue = value.toString();
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:get', { key, value: stringValue });
      return stringValue;
    }
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {!Promise<void>}
   */
  async delete(key) {
    await this.client_.delete(key);
    if (this.eventEmitter_) this.eventEmitter_.emit('cache:delete', { key });
  }

  /**
   * Gets analytics data for cache operations.
   * @return {Array<{key: string, hits: number, lastHit: string}>} Analytics data.
   */
  getAnalytics() {
    const analytics = Array.from(this.analytics_.values());
    return analytics.map(entry => ({
      key: entry.key,
      hits: entry.hits,
      lastHit: entry.lastHit.toISOString()
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
        lastHit: now
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

module.exports = CacheMemcached;
