/**
 * @fileoverview A file-based cache implementation providing persistent caching
 * functionality with analytics tracking for cache operations.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * A class that implements a file-based cache with analytics tracking.
 * Provides methods for storing, retrieving, and deleting cached values to/from disk.
 * @class
 */
class CacheFile {
  /**
   * Initializes the file cache with storage directory and analytics.
   * @param {Object=} options Configuration options for the file cache.
   * @param {string=} options.cacheDir Directory to store cache files (defaults to './.cache').
   * @param {number=} options.maxAnalyticsEntries Maximum analytics entries to keep.
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events.
   */
  constructor(options = {}, eventEmitter) {
    /** @private @const {string} */
    this.cacheDir_ = options.cacheDir || './.cache';
    this.eventEmitter_ = eventEmitter;
    /** @private @const {!Map<string, {key: string, hits: number, lastHit: Date}>} */
    this.analytics_ = new Map();
    /** @private @const {number} */
    this.maxAnalyticsEntries_ = options.maxAnalyticsEntries || 100;
    
    this.initializeCacheDir_();
  }

  /**
   * Initializes the cache directory if it doesn't exist.
   * @private
   */
  async initializeCacheDir_() {
    try {
      await fs.access(this.cacheDir_);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(this.cacheDir_, { recursive: true });
      }
    }
  }

  /**
   * Generates a safe filename for the given cache key.
   * @param {string} key The cache key.
   * @return {string} A safe filename.
   * @private
   */
  getFilePath_(key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.cacheDir_, `${hash}.json`);
  }

  /**
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   * @return {Promise<void>} A promise that resolves when the value is stored.
   */
  async put(key, value) {
    const filePath = this.getFilePath_(key);
    const cacheEntry = {
      key,
      value,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.initializeCacheDir_();
      await fs.writeFile(filePath, JSON.stringify(cacheEntry, null, 2), 'utf8');
      this.trackOperation_(key);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:put', { key, value });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:error', { operation: 'put', key, error });
      throw error;
    }
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {Promise<*>} A promise that resolves to the cached value, or undefined if not found.
   */
  async get(key) {
    const filePath = this.getFilePath_(key);

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const cacheEntry = JSON.parse(data);
      this.trackOperation_(key);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:get', { key, value: cacheEntry.value });
      return cacheEntry.value;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.trackOperation_(key);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('cache:get', { key, value: undefined });
        return undefined;
      }
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:error', { operation: 'get', key, error });
      throw error;
    }
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {Promise<void>} A promise that resolves when the key is deleted.
   */
  async delete(key) {
    const filePath = this.getFilePath_(key);

    try {
      await fs.unlink(filePath);
      if (this.eventEmitter_) this.eventEmitter_.emit('cache:delete', { key });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (this.eventEmitter_)
          this.eventEmitter_.emit('cache:error', { operation: 'delete', key, error });
        throw error;
      }
    }
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
   * Clears all cached files from the cache directory.
   * @return {Promise<void>} A promise that resolves when all cache files are deleted.
   */
  async clear() {
    try {
      const files = await fs.readdir(this.cacheDir_);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      await Promise.all(
        jsonFiles.map(file => fs.unlink(path.join(this.cacheDir_, file)))
      );

      this.analytics_.clear();
      if (this.eventEmitter_) this.eventEmitter_.emit('cache:clear');
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:error', { operation: 'clear', error });
      throw error;
    }
  }

  /**
   * Gets cache statistics including file count and directory size.
   * @return {Promise<{fileCount: number, totalSize: number}>} Cache statistics.
   */
  async getStats() {
    try {
      const files = await fs.readdir(this.cacheDir_);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      let totalSize = 0;
      for (const file of jsonFiles) {
        const filePath = path.join(this.cacheDir_, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }

      return {
        fileCount: jsonFiles.length,
        totalSize,
      };
    } catch (error) {
      return {
        fileCount: 0,
        totalSize: 0,
      };
    }
  }

  /**
   * Tracks a cache operation for analytics.
   * @param {string} key The cache key being accessed.
   * @private
   */
  trackOperation_(key) {
    const now = new Date();

    if (this.analytics_.has(key)) {
      const entry = this.analytics_.get(key);
      entry.hits++;
      entry.lastHit = now;
    } else {
      const entry = {
        key: key,
        hits: 1,
        lastHit: now,
      };

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

module.exports = CacheFile;
