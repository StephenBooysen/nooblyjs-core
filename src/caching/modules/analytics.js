/**
 * @fileoverview Caching Analytics Module
 * Captures and stores cache activity metrics for analytics purposes.
 * Tracks get/put/delete operations, hits, misses, and provides statistics.
 *
 * @author NooblyJS Core Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

/**
 * A class that captures and stores cache activity metrics for analytics.
 * Maintains statistics about cache operations and activity over time.
 * @class
 */
class CacheAnalytics {
  /**
   * Initializes the cache analytics module.
   * @param {EventEmitter} eventEmitter - Event emitter to listen for cache events.
   * @param {string} instanceName - The instance name this analytics module tracks (default: 'default').
   */
  constructor(eventEmitter, instanceName = 'default') {
    this.MAX_ACTIVITY_ENTRIES_ = 1000;
    this.keyStats_ = new Map();
    this.keyActivity_ = new Map();
    this.keyMisses_ = new Map();
    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = instanceName;

    // Set up event listeners for cache operations
    this.initializeListeners_();
  }

  /**
   * Initializes event listeners for cache operations.
   * @private
   */
  initializeListeners_() {
    if (!this.eventEmitter_) {
      return;
    }

    const getEventName = `cache:get:${this.instanceName_}`;
    const putEventName = `cache:put:${this.instanceName_}`;
    const deleteEventName = `cache:delete:${this.instanceName_}`;

    // Store listener references for cleanup
    this.listeners_ = {};

    this.listeners_.get = (data) => {
      const isHit = data.value !== undefined;
      if (isHit) {
        this.recordActivity_(data.key, 'hit', data.value);
      } else {
        this.recordActivity_(data.key, 'miss', null);
        // Track misses separately
        const currentMisses = this.keyMisses_.get(data.key) || 0;
        this.keyMisses_.set(data.key, currentMisses + 1);
      }
    };

    this.listeners_.put = (data) => {
      this.recordActivity_(data.key, 'put', data.value);
    };

    this.listeners_.delete = (data) => {
      this.recordActivity_(data.key, 'delete', null);
    };

    this.listeners_.eventNames_ = {
      get: getEventName,
      put: putEventName,
      delete: deleteEventName
    };

    // Listen for get events (can be hit or miss)
    this.eventEmitter_.on(getEventName, this.listeners_.get);

    // Listen for put events (writes)
    this.eventEmitter_.on(putEventName, this.listeners_.put);

    // Listen for delete events
    this.eventEmitter_.on(deleteEventName, this.listeners_.delete);
  }

  /**
   * Records a cache activity event.
   * @private
   * @param {string} key - The cache key.
   * @param {string} operation - The operation type (hit, miss, put, delete).
   * @param {*} value - The value involved in the operation.
   */
  recordActivity_(key, operation, value) {
    // Initialize stats for this key if it doesn't exist
    if (!this.keyStats_.has(key)) {
      this.keyStats_.set(key, {
        hitCount: 0,
        missCount: 0,
        putCount: 0,
        deleteCount: 0,
        totalReads: 0,
        totalWrites: 0,
        firstActivity: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      });
    }

    // Initialize activity array for this key if it doesn't exist
    if (!this.keyActivity_.has(key)) {
      this.keyActivity_.set(key, []);
    }

    // Update statistics
    const stats = this.keyStats_.get(key);
    const activity = this.keyActivity_.get(key);

    if (operation === 'hit') {
      stats.hitCount++;
      stats.totalReads++;
    } else if (operation === 'miss') {
      stats.missCount++;
      stats.totalReads++;
    } else if (operation === 'put') {
      stats.putCount++;
      stats.totalWrites++;
    } else if (operation === 'delete') {
      stats.deleteCount++;
      stats.totalWrites++;
    }

    stats.lastActivity = new Date().toISOString();

    // Record activity entry
    const activityEntry = {
      operation: operation,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now()
    };

    // Add to the beginning for newest-first ordering
    activity.unshift(activityEntry);

    // Maintain max size by removing oldest entries
    if (activity.length > this.MAX_ACTIVITY_ENTRIES_) {
      activity.pop();
    }
  }

  /**
   * Gets statistics for all cache keys.
   * @return {Object} Statistics object with key counts and totals.
   */
  getStats() {
    const keys = Array.from(this.keyStats_.keys());
    let totalHits = 0;
    let totalMisses = 0;
    let totalReads = 0;
    let totalWrites = 0;

    const keyStatsObj = {};

    keys.forEach(key => {
      const stats = this.keyStats_.get(key);
      keyStatsObj[key] = { ...stats };
      totalHits += stats.hitCount;
      totalMisses += stats.missCount;
      totalReads += stats.totalReads;
      totalWrites += stats.totalWrites;
    });

    return {
      totalKeys: keys.length,
      totalHits: totalHits,
      totalMisses: totalMisses,
      totalReads: totalReads,
      totalWrites: totalWrites,
      keys: keyStatsObj
    };
  }

  /**
   * Gets statistics for a specific cache key.
   * @param {string} key - The cache key.
   * @return {Object|null} Statistics for the key or null if not found.
   */
  getKeyStats(key) {
    if (!this.keyStats_.has(key)) {
      return null;
    }

    return { ...this.keyStats_.get(key) };
  }

  /**
   * Gets the distribution of hits across top cache keys for pie chart.
   * @param {number} limit - Number of top keys to include.
   * @return {Object} Distribution data with labels and values.
   */
  getHitDistribution(limit = 50) {
    const labels = [];
    const data = [];

    // Get top keys by hit count
    const topKeys = this.getTopKeys(limit, 'hits');

    topKeys.forEach(keyInfo => {
      labels.push(keyInfo.name);
      data.push(keyInfo.hitCount);
    });

    return {
      labels: labels,
      data: data
    };
  }

  /**
   * Gets the top N cache keys by various metrics.
   * @param {number} limit - Number of top keys to return.
   * @param {string} sortBy - Metric to sort by ('hits', 'activity', 'reads', 'writes').
   * @return {Array} Array of key statistics sorted by specified metric.
   */
  getTopKeys(limit = 10, sortBy = 'hits') {
    const keys = Array.from(this.keyStats_.entries()).map(([name, stats]) => ({
      name: name,
      hitCount: stats.hitCount,
      missCount: stats.missCount,
      totalActivity: stats.hitCount + stats.missCount + stats.putCount + stats.deleteCount,
      totalReads: stats.totalReads,
      totalWrites: stats.totalWrites,
      putCount: stats.putCount,
      deleteCount: stats.deleteCount
    }));

    // Sort by specified metric
    switch (sortBy) {
      case 'hits':
        keys.sort((a, b) => b.hitCount - a.hitCount);
        break;
      case 'activity':
        keys.sort((a, b) => b.totalActivity - a.totalActivity);
        break;
      case 'reads':
        keys.sort((a, b) => b.totalReads - a.totalReads);
        break;
      case 'writes':
        keys.sort((a, b) => b.totalWrites - a.totalWrites);
        break;
      default:
        keys.sort((a, b) => b.hitCount - a.hitCount);
    }

    return keys.slice(0, limit);
  }

  /**
   * Gets the top N cache misses.
   * @param {number} limit - Number of top misses to return.
   * @return {Array} Array of keys with highest miss counts.
   */
  getTopMisses(limit = 50) {
    const misses = Array.from(this.keyMisses_.entries())
      .map(([key, count]) => ({
        key: key,
        missCount: count,
        stats: this.getKeyStats(key)
      }))
      .sort((a, b) => b.missCount - a.missCount)
      .slice(0, limit);

    return misses;
  }

  /**
   * Gets timeline data showing cache activity over time for top keys.
   * @param {number} topN - Number of top keys to include in timeline.
   * @return {Object} Timeline object with time labels and datasets for each key.
   */
  getTimeline(topN = 10) {
    const topKeys = this.getTopKeys(topN, 'activity');

    if (topKeys.length === 0) {
      return {
        labels: [],
        datasets: []
      };
    }

    // Create a map to store counts per minute per key
    const timeMap = new Map();

    // Process activity for each top key
    topKeys.forEach(keyInfo => {
      const keyName = keyInfo.name;
      const activity = this.keyActivity_.get(keyName) || [];

      activity.forEach(entry => {
        const entryTime = new Date(entry.timestamp);
        // Round down to the nearest minute
        const minuteKey = new Date(entryTime.getFullYear(), entryTime.getMonth(), entryTime.getDate(),
                                   entryTime.getHours(), entryTime.getMinutes(), 0, 0).getTime();

        if (!timeMap.has(minuteKey)) {
          const keyCounts = {};
          topKeys.forEach(k => {
            keyCounts[k.name] = 0;
          });
          timeMap.set(minuteKey, keyCounts);
        }

        const counts = timeMap.get(minuteKey);
        counts[keyName]++;
      });
    });

    // Sort time keys and create labels
    const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);
    const labels = sortedTimes.map(time => {
      const date = new Date(time);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    });

    // Create datasets for each key
    const datasets = topKeys.map(keyInfo => ({
      name: keyInfo.name,
      data: sortedTimes.map(time => timeMap.get(time)[keyInfo.name] || 0)
    }));

    return {
      labels: labels,
      datasets: datasets
    };
  }

  /**
   * Gets a list of cache keys with their statistics.
   * @param {number} limit - Maximum number of keys to return.
   * @return {Array} Array of key information with statistics.
   */
  getKeyList(limit = 100) {
    const keys = this.getTopKeys(limit, 'activity');

    return keys.map(k => ({
      name: k.name,
      hitCount: k.hitCount,
      missCount: k.missCount,
      totalReads: k.totalReads,
      totalWrites: k.totalWrites,
      stats: this.getKeyStats(k.name)
    }));
  }

  /**
   * Removes event listeners and clears all stored analytics data to prevent memory leaks.
   * Call this when a caching instance is no longer needed.
   * @return {void}
   */
  destroy() {
    if (this.eventEmitter_ && this.listeners_ && this.listeners_.eventNames_) {
      const names = this.listeners_.eventNames_;
      this.eventEmitter_.removeListener(names.get, this.listeners_.get);
      this.eventEmitter_.removeListener(names.put, this.listeners_.put);
      this.eventEmitter_.removeListener(names.delete, this.listeners_.delete);
    }
    this.keyStats_.clear();
    this.keyActivity_.clear();
    this.keyMisses_.clear();
  }

  /**
   * Clears all stored analytics data without removing event listeners.
   * @return {void}
   */
  clear() {
    this.keyStats_.clear();
    this.keyActivity_.clear();
    this.keyMisses_.clear();
  }

  /**
   * Gets the total count of tracked cache keys.
   * @return {number} The number of keys being tracked.
   */
  getKeyCount() {
    return this.keyStats_.size;
  }
}

module.exports = CacheAnalytics;
