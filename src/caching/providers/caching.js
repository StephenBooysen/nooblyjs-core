/**
 * @fileoverview A simple in-memory cache implementation.
 */

/**
 * A class that implements a simple in-memory cache.
 */
class Cache {
  /**
   * Initializes the cache.
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
   * @return {*} The cached value, or undefined if the key is not found.
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
   */
  async delete(key) {
    delete this.cache_[key];
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

module.exports = Cache;
