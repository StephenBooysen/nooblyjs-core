/**
 * @fileoverview Fetching Analytics Module
 * Captures and stores fetch activity metrics for analytics purposes.
 * Tracks request operations, cache hits, misses, and provides statistics.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

/**
 * A class that captures and stores fetch activity metrics for analytics.
 * Maintains statistics about fetch operations and activity over time.
 * @class
 */
class FetchingAnalytics {
  /**
   * Initializes the fetching analytics module.
   * @param {EventEmitter} eventEmitter - Event emitter to listen for fetch events.
   */
  constructor(eventEmitter) {
    this.MAX_ACTIVITY_ENTRIES_ = 1000;
    this.urlStats_ = new Map();
    this.urlActivity_ = new Map();
    this.urlErrors_ = new Map();
    this.eventEmitter_ = eventEmitter;

    // Set up event listeners for fetch operations
    this.initializeListeners_();
  }

  /**
   * Initializes event listeners for fetch operations.
   * @private
   */
  initializeListeners_() {
    if (!this.eventEmitter_) {
      return;
    }

    // Store listener references so they can be removed in destroy() (P2-6).
    this.listeners_ = {
      'fetch:success': (data) => {
        this.recordActivity_(data.url, 'success', data.status, null);
      },
      'fetch:cache-hit': (data) => {
        this.recordActivity_(data.url, 'cache-hit', 0, null);
      },
      'fetch:dedup-hit': (data) => {
        this.recordActivity_(data.url, 'dedup-hit', 0, null);
      },
      'fetch:error': (data) => {
        this.recordActivity_(data.url, 'error', 0, data.error);
        const currentErrors = this.urlErrors_.get(data.url) || 0;
        this.urlErrors_.set(data.url, currentErrors + 1);
      }
    };

    for (const [event, handler] of Object.entries(this.listeners_)) {
      this.eventEmitter_.on(event, handler);
    }
  }

  /**
   * Removes all event listeners registered by this analytics module.
   * Call when the owning service is disposed to prevent listener leaks (P2-6).
   */
  destroy() {
    if (this.eventEmitter_ && this.listeners_) {
      for (const [event, handler] of Object.entries(this.listeners_)) {
        this.eventEmitter_.removeListener(event, handler);
      }
      this.listeners_ = null;
    }
  }

  /**
   * Records a fetch activity event.
   * @private
   * @param {string} url - The fetched URL.
   * @param {string} operation - The operation type (success, cache-hit, dedup-hit, error).
   * @param {number} status - HTTP status code.
   * @param {string|null} error - Error message if applicable.
   */
  recordActivity_(url, operation, status, error) {
    // Initialize stats for this URL if it doesn't exist
    if (!this.urlStats_.has(url)) {
      this.urlStats_.set(url, {
        successCount: 0,
        cacheHitCount: 0,
        dedupHitCount: 0,
        errorCount: 0,
        totalRequests: 0,
        firstRequest: new Date().toISOString(),
        lastRequest: new Date().toISOString(),
        lastStatus: status,
        averageResponseTime: 0
      });
    }

    // Initialize activity array for this URL if it doesn't exist
    if (!this.urlActivity_.has(url)) {
      this.urlActivity_.set(url, []);
    }

    // Update statistics
    const stats = this.urlStats_.get(url);
    const activity = this.urlActivity_.get(url);

    stats.totalRequests++;
    stats.lastRequest = new Date().toISOString();

    if (operation === 'success') {
      stats.successCount++;
      stats.lastStatus = status;
    } else if (operation === 'cache-hit') {
      stats.cacheHitCount++;
    } else if (operation === 'dedup-hit') {
      stats.dedupHitCount++;
    } else if (operation === 'error') {
      stats.errorCount++;
    }

    // Record activity entry
    const activityEntry = {
      operation: operation,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      status: status,
      error: error
    };

    // Add to the beginning for newest-first ordering
    activity.unshift(activityEntry);

    // Maintain max size by removing oldest entries
    if (activity.length > this.MAX_ACTIVITY_ENTRIES_) {
      activity.pop();
    }
  }

  /**
   * Gets statistics for all fetched URLs.
   * @return {Object} Statistics object with key counts and totals.
   */
  getStats() {
    const urls = Array.from(this.urlStats_.keys());
    let totalSuccess = 0;
    let totalCacheHits = 0;
    let totalDedupHits = 0;
    let totalErrors = 0;
    let totalRequests = 0;

    const urlStatsObj = {};

    urls.forEach(url => {
      const stats = this.urlStats_.get(url);
      urlStatsObj[url] = { ...stats };
      totalSuccess += stats.successCount;
      totalCacheHits += stats.cacheHitCount;
      totalDedupHits += stats.dedupHitCount;
      totalErrors += stats.errorCount;
      totalRequests += stats.totalRequests;
    });

    return {
      totalUrls: urls.length,
      totalSuccess: totalSuccess,
      totalCacheHits: totalCacheHits,
      totalDedupHits: totalDedupHits,
      totalErrors: totalErrors,
      totalRequests: totalRequests,
      cacheHitRate: totalRequests > 0 ? ((totalCacheHits + totalDedupHits) / totalRequests * 100).toFixed(2) : '0.00',
      successRate: totalRequests > 0 ? (totalSuccess / totalRequests * 100).toFixed(2) : '0.00',
      urls: urlStatsObj
    };
  }

  /**
   * Gets statistics for a specific URL.
   * @param {string} url - The URL.
   * @return {Object|null} Statistics for the URL or null if not found.
   */
  getUrlStats(url) {
    if (!this.urlStats_.has(url)) {
      return null;
    }

    return { ...this.urlStats_.get(url) };
  }

  /**
   * Gets the distribution of requests across top URLs for pie chart.
   * @param {number} limit - Number of top URLs to include.
   * @return {Object} Distribution data with labels and values.
   */
  getUrlDistribution(limit = 50) {
    const labels = [];
    const data = [];

    // Get top URLs by request count
    const topUrls = this.getTopUrls(limit, 'requests');

    topUrls.forEach(urlInfo => {
      labels.push(urlInfo.name);
      data.push(urlInfo.totalRequests);
    });

    return {
      labels: labels,
      data: data
    };
  }

  /**
   * Gets the top N URLs by various metrics.
   * @param {number} limit - Number of top URLs to return.
   * @param {string} sortBy - Metric to sort by ('requests', 'errors', 'success', 'cache').
   * @return {Array} Array of URL statistics sorted by specified metric.
   */
  getTopUrls(limit = 10, sortBy = 'requests') {
    const urls = Array.from(this.urlStats_.entries()).map(([name, stats]) => ({
      name: name,
      totalRequests: stats.totalRequests,
      successCount: stats.successCount,
      cacheHitCount: stats.cacheHitCount,
      dedupHitCount: stats.dedupHitCount,
      errorCount: stats.errorCount,
      lastStatus: stats.lastStatus,
      lastRequest: stats.lastRequest
    }));

    // Sort by specified metric
    switch (sortBy) {
      case 'requests':
        urls.sort((a, b) => b.totalRequests - a.totalRequests);
        break;
      case 'errors':
        urls.sort((a, b) => b.errorCount - a.errorCount);
        break;
      case 'success':
        urls.sort((a, b) => b.successCount - a.successCount);
        break;
      case 'cache':
        urls.sort((a, b) => (b.cacheHitCount + b.dedupHitCount) - (a.cacheHitCount + a.dedupHitCount));
        break;
      default:
        urls.sort((a, b) => b.totalRequests - a.totalRequests);
    }

    return urls.slice(0, limit);
  }

  /**
   * Gets the top N URLs with errors.
   * @param {number} limit - Number of top error URLs to return.
   * @return {Array} Array of URLs with highest error counts.
   */
  getTopErrors(limit = 50) {
    const errors = Array.from(this.urlErrors_.entries())
      .map(([url, count]) => ({
        url: url,
        errorCount: count,
        stats: this.getUrlStats(url)
      }))
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, limit);

    return errors;
  }

  /**
   * Gets timeline data showing fetch activity over time for top URLs.
   * @param {number} topN - Number of top URLs to include in timeline.
   * @return {Object} Timeline object with time labels and datasets for each URL.
   */
  getTimeline(topN = 10) {
    const topUrls = this.getTopUrls(topN, 'requests');

    if (topUrls.length === 0) {
      return {
        labels: [],
        datasets: []
      };
    }

    // Create a map to store counts per minute per URL
    const timeMap = new Map();

    // Process activity for each top URL
    topUrls.forEach(urlInfo => {
      const urlName = urlInfo.name;
      const activity = this.urlActivity_.get(urlName) || [];

      activity.forEach(entry => {
        const entryTime = new Date(entry.timestamp);
        // Round down to the nearest minute
        const minuteKey = new Date(entryTime.getFullYear(), entryTime.getMonth(), entryTime.getDate(),
                                   entryTime.getHours(), entryTime.getMinutes(), 0, 0).getTime();

        if (!timeMap.has(minuteKey)) {
          const urlCounts = {};
          topUrls.forEach(u => {
            urlCounts[u.name] = 0;
          });
          timeMap.set(minuteKey, urlCounts);
        }

        const counts = timeMap.get(minuteKey);
        counts[urlName]++;
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

    // Create datasets for each URL
    const datasets = topUrls.map(urlInfo => ({
      name: urlInfo.name,
      data: sortedTimes.map(time => timeMap.get(time)[urlInfo.name] || 0)
    }));

    return {
      labels: labels,
      datasets: datasets
    };
  }

  /**
   * Gets a list of URLs with their statistics.
   * @param {number} limit - Maximum number of URLs to return.
   * @return {Array} Array of URL information with statistics.
   */
  getUrlList(limit = 100) {
    const urls = this.getTopUrls(limit, 'requests');

    return urls.map(u => ({
      name: u.name,
      totalRequests: u.totalRequests,
      successCount: u.successCount,
      cacheHitCount: u.cacheHitCount,
      dedupHitCount: u.dedupHitCount,
      errorCount: u.errorCount,
      lastStatus: u.lastStatus,
      lastRequest: u.lastRequest,
      stats: this.getUrlStats(u.name)
    }));
  }

  /**
   * Clears all stored analytics data.
   * @return {void}
   */
  clear() {
    this.urlStats_.clear();
    this.urlActivity_.clear();
    this.urlErrors_.clear();
  }

  /**
   * Gets the total count of tracked URLs.
   * @return {number} The number of URLs being tracked.
   */
  getUrlCount() {
    return this.urlStats_.size;
  }
}

module.exports = FetchingAnalytics;
