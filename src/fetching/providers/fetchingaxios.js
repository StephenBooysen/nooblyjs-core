/**
 * @fileoverview Axios-based Fetching Provider
 * Implements HTTP fetching using axios library with advanced caching
 * and request deduplication support.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const axios = require('axios');
const { assertUrlAllowed, followRedirects } = require('../modules/ssrfGuard');

/**
 * A class that implements HTTP fetching using axios.
 * Provides caching, request deduplication, and analytics tracking.
 * @class
 */
class FetchingAxios {
  /**
   * Initializes the axios fetching provider.
   * @param {Object=} options Configuration options
   * @param {number} options.cacheTime - Default cache duration in seconds
   * @param {number} options.timeout - Request timeout in milliseconds
   * @param {Object} options.axiosConfig - Additional axios config
   * @param {EventEmitter=} eventEmitter Optional event emitter for fetch events
   */
  constructor(options = {}, eventEmitter) {
    this.settings = {
      description: 'Axios-based HTTP fetching provider',
      list: [
        { setting: 'cacheTime', description: 'Default cache duration (seconds)' },
        { setting: 'timeout', description: 'Request timeout (milliseconds)' }
      ]
    };

    this.cacheTime = options.cacheTime || 60;
    this.timeout = options.timeout || 30000;
    this.requestCache_ = new Map();
    this.requestDedup_ = new Map();
    this.eventEmitter_ = eventEmitter;
    this.analytics_ = new Map();
    this.maxAnalyticsEntries_ = 1000;

    // SSRF guard configuration (fails closed by default).
    this.ssrfOptions_ = options.ssrf || {};

    // Create axios instance with custom config
    this.axiosInstance = axios.create({
      timeout: this.timeout,
      ...(options.axiosConfig || {})
    });
  }

  /**
   * Get all settings
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Save settings
   */
  async saveSettings(settings) {
    if (settings.cacheTime !== undefined) {
      this.cacheTime = settings.cacheTime;
    }
    if (settings.timeout !== undefined) {
      this.timeout = settings.timeout;
      this.axiosInstance.defaults.timeout = settings.timeout;
    }
  }

  /**
   * Fetches a URL with optional caching and deduplication.
   * Follows NextJS fetch specification adapted for axios.
   *
   * @param {string} url - The URL to fetch
   * @param {Object=} options - Fetch options
   * @param {string} options.method - HTTP method (default: 'GET')
   * @param {Object|string} options.body - Request data
   * @param {Object} options.headers - Request headers
   * @param {number} options.next - Cache options: { revalidate: seconds, tags: [strings] }
   * @param {string} options.cache - Cache control ('default', 'force-cache', 'no-store', 'no-cache')
   * @return {Promise<Object>} Response object with data, status, headers
   */
  async fetch(url, options = {}) {
    // SSRF guard: validate the destination before any network/cache activity.
    await assertUrlAllowed(url, this.ssrfOptions_);

    const cacheKey = this.getCacheKey_(url, options);
    const startTime = Date.now();

    try {
      // Check deduplication cache
      if (this.requestDedup_.has(cacheKey)) {
        const pendingPromise = this.requestDedup_.get(cacheKey);
        const response = await pendingPromise;
        this.trackOperation_(cacheKey, 'dedup-hit', response.status);
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('fetch:dedup-hit', { url, cacheKey });
        }
        return response;
      }

      // Check request cache
      const cachedResponse = this.getCachedResponse_(cacheKey, options);
      if (cachedResponse) {
        this.trackOperation_(cacheKey, 'cache-hit', cachedResponse.status);
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('fetch:cache-hit', { url, cacheKey });
        }
        return cachedResponse;
      }

      // Create a promise for this request
      const fetchPromise = this.performFetch_(url, options, cacheKey);

      // Store in deduplication cache
      this.requestDedup_.set(cacheKey, fetchPromise);

      try {
        const response = await fetchPromise;

        // Cache successful responses if applicable
        if (this.shouldCache_(response, options)) {
          const cacheTime = this.getCacheTime_(options);
          this.setCachedResponse_(cacheKey, response, cacheTime);
        }

        this.trackOperation_(cacheKey, 'fetch', response.status);
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('fetch:success', { url, cacheKey, status: response.status });
        }

        return response;
      } finally {
        // Remove from deduplication cache
        this.requestDedup_.delete(cacheKey);
      }
    } catch (error) {
      this.trackOperation_(cacheKey, 'error', 0, error.message);
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('fetch:error', { url, cacheKey, error: error.message });
      }
      throw error;
    }
  }

  /**
   * Performs the actual HTTP request using axios.
   * @private
   * @param {string} url - The URL to fetch
   * @param {Object} options - Fetch options
   * @param {string} cacheKey - The cache key for this request
   * @return {Promise<Object>} Response object
   */
  async performFetch_(url, options, cacheKey) {
    const axiosConfig = {
      method: options.method || 'GET',
      url: url,
      headers: options.headers || {},
      timeout: this.timeout,
      ...(options.body && { data: options.body })
    };

    // Remove custom options
    if (options.axiosConfig) {
      Object.assign(axiosConfig, options.axiosConfig);
    }

    // Redirects are followed here, not by axios, so each hop passes the SSRF guard.
    // Redirect statuses come back as responses; other 4xx/5xx still throw as before.
    const hasBody = axiosConfig.data !== undefined;
    const { url: finalUrl, response } = await followRedirects(url, {
      method: axiosConfig.method,
      hasBody,
      send: async (target, { method, keepBody }) => {
        const hop = await this.axiosInstance({
          ...axiosConfig,
          url: target,
          method,
          data: keepBody ? axiosConfig.data : undefined,
          maxRedirects: 0,
          // A caller's own validateStatus still decides what counts as an error.
          validateStatus: axiosConfig.validateStatus ??
            ((status) => status < 400 || [301, 302, 303, 307, 308].includes(status))
        });
        return { status: hop.status, location: hop.headers?.location ?? null, response: hop };
      }
    }, this.ssrfOptions_);

    // Normalize axios response to match fetch API response
    const normalizedResponse = {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText,
      data: response.data,
      headers: response.headers,
      url: response.config.url,
      _metadata: {
        cacheKey: cacheKey,
        timestamp: Date.now(),
        provider: 'axios'
      },
      clone: function() {
        return {
          ...this,
          data: JSON.parse(JSON.stringify(this.data))
        };
      }
    };

    return normalizedResponse;
  }

  /**
   * Generates a cache key from URL and options.
   * @private
   * @param {string} url - The URL
   * @param {Object} options - Fetch options
   * @return {string} Cache key
   */
  getCacheKey_(url, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.stringify(options.body) : '';
    const cacheTag = options.next?.tags?.join(',') || '';
    return `${method}:${url}:${body}:${cacheTag}`;
  }

  /**
   * Determines if a response should be cached.
   * @private
   * @param {Object} response - The response object
   * @param {Object} options - Original fetch options
   * @return {boolean} Whether to cache
   */
  shouldCache_(response, options) {
    if (options.cache === 'no-store' || (options.method && options.method !== 'GET')) {
      return false;
    }
    return response.ok;
  }

  /**
   * Gets the cache time from options.
   * @private
   * @param {Object} options - Fetch options
   * @return {number} Cache time in seconds
   */
  getCacheTime_(options) {
    if (options.cache === 'force-cache') {
      return Number.MAX_SAFE_INTEGER; // Cache indefinitely
    }
    if (options.next?.revalidate !== undefined) {
      return options.next.revalidate;
    }
    return this.cacheTime;
  }

  /**
   * Gets a cached response if it exists and hasn't expired.
   * @private
   * @param {string} cacheKey - The cache key
   * @param {Object} options - Fetch options
   * @return {Object|null} Cached response or null
   */
  getCachedResponse_(cacheKey, options) {
    if (options.cache === 'no-cache' || options.cache === 'no-store') {
      return null;
    }

    const cached = this.requestCache_.get(cacheKey);
    if (!cached) {
      return null;
    }

    // Check if cache has expired
    const age = (Date.now() - cached.timestamp) / 1000;
    if (age > cached.duration) {
      this.requestCache_.delete(cacheKey);
      return null;
    }

    return cached.response.clone();
  }

  /**
   * Stores a response in the cache.
   * @private
   * @param {string} cacheKey - The cache key
   * @param {Object} response - The response to cache
   * @param {number} duration - Cache duration in seconds
   */
  setCachedResponse_(cacheKey, response, duration) {
    this.requestCache_.set(cacheKey, {
      response: response,
      duration: duration,
      timestamp: Date.now()
    });

    // Cleanup old entries if cache is too large
    if (this.requestCache_.size > 1000) {
      const oldestKey = this.getOldestCacheKey_();
      if (oldestKey) {
        this.requestCache_.delete(oldestKey);
      }
    }
  }

  /**
   * Finds the oldest cache entry.
   * @private
   * @return {string|null} The oldest cache key
   */
  getOldestCacheKey_() {
    let oldestKey = null;
    let oldestTime = null;

    for (const [key, entry] of this.requestCache_) {
      if (!oldestTime || entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Tracks fetch analytics.
   * @private
   * @param {string} cacheKey - The cache key
   * @param {string} operation - The operation type
   * @param {number} status - HTTP status code
   * @param {string} error - Error message if applicable
   */
  trackOperation_(cacheKey, operation, status, error = null) {
    if (!this.analytics_.has(cacheKey)) {
      this.analytics_.set(cacheKey, {
        url: cacheKey,
        requests: 0,
        cacheHits: 0,
        dedupHits: 0,
        errors: 0,
        lastRequest: null,
        lastStatus: status
      });
    }

    const stats = this.analytics_.get(cacheKey);
    stats.requests++;
    stats.lastStatus = status;

    if (operation === 'cache-hit') {
      stats.cacheHits++;
    } else if (operation === 'dedup-hit') {
      stats.dedupHits++;
    } else if (operation === 'error') {
      stats.errors++;
    }

    stats.lastRequest = new Date().toISOString();

    // Maintain analytics size limit
    if (this.analytics_.size > this.maxAnalyticsEntries_) {
      const oldestKey = this.getOldestAnalyticsKey_();
      if (oldestKey) {
        this.analytics_.delete(oldestKey);
      }
    }
  }

  /**
   * Gets the oldest analytics entry.
   * @private
   * @return {string|null} The oldest key
   */
  getOldestAnalyticsKey_() {
    let oldestKey = null;
    let oldestTime = null;

    for (const [key, entry] of this.analytics_) {
      if (!oldestTime || new Date(entry.lastRequest) < oldestTime) {
        oldestTime = new Date(entry.lastRequest);
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Gets analytics data.
   * @return {Array} Analytics data
   */
  getAnalytics() {
    return Array.from(this.analytics_.values());
  }

  /**
   * Clears all caches.
   * @return {Promise<void>}
   */
  async clear() {
    this.requestCache_.clear();
    this.requestDedup_.clear();
    this.analytics_.clear();
  }
}

module.exports = FetchingAxios;
