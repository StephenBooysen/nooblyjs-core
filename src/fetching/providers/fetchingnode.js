/**
 * @fileoverview Node.js Native Fetching Provider
 * Implements HTTP fetching using Node.js native fetch API (or node-fetch polyfill)
 * Follows NextJS fetch specification with caching and deduplication support.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const { assertUrlAllowed, followRedirects } = require('../modules/ssrfGuard');

/**
 * A class that implements HTTP fetching using Node.js native fetch API.
 * Provides caching, request deduplication, and analytics tracking.
 * @class
 */
class FetchingNode {
  /**
   * Initializes the Node.js fetching provider.
   * @param {Object=} options Configuration options
   * @param {number} options.cacheTime - Default cache duration in seconds
   * @param {number} options.timeout - Request timeout in milliseconds
   * @param {EventEmitter=} eventEmitter Optional event emitter for fetch events
   */
  constructor(options = {}, eventEmitter) {
    this.settings = {
      description: 'Node.js native fetch provider',
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

    // Determine if we have native fetch
    this.hasFetch = typeof fetch !== 'undefined';
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
    }
  }

  /**
   * Fetches a URL with optional caching and deduplication.
   * Follows NextJS fetch specification: https://nextjs.org/docs/app/api-reference/functions/fetch
   *
   * @param {string} url - The URL to fetch
   * @param {Object=} options - Fetch options
   * @param {string} options.method - HTTP method (default: 'GET')
   * @param {Object|string} options.body - Request body
   * @param {Object} options.headers - Request headers
   * @param {number} options.next - Cache options: { revalidate: seconds, tags: [strings] }
   * @param {string} options.cache - Cache control ('default', 'force-cache', 'no-store', 'no-cache')
   * @return {Promise<Response>} Response object
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
        // A Response body can only be read once, so every caller of a shared
        // (de-duplicated or cached) response gets its own clone.
        return response.clone();
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

        return response.clone();
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
   * Performs the actual HTTP request.
   * @private
   * @param {string} url - The URL to fetch
   * @param {Object} options - Fetch options
   * @param {string} cacheKey - The cache key for this request
   * @return {Promise<Response>} Response object
   */
  async performFetch_(url, options, cacheKey) {
    const fetchOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      signal: AbortSignal.timeout(this.timeout),
      ...options
    };

    // Remove custom options that aren't part of fetch API
    delete fetchOptions.next;
    delete fetchOptions.cache;

    // Redirects are followed here, not by fetch, so each hop passes the SSRF guard.
    const hasBody = fetchOptions.body !== undefined && fetchOptions.body !== null;
    const { url: finalUrl, response } = await followRedirects(url, {
      method: fetchOptions.method,
      hasBody,
      send: async (target, { method, keepBody }) => {
        const hop = await fetch(target, {
          ...fetchOptions,
          method,
          body: keepBody ? fetchOptions.body : undefined,
          redirect: 'manual'
        });
        return { status: hop.status, location: hop.headers.get('location'), response: hop };
      }
    }, this.ssrfOptions_);

    // Clone the response so it can be used multiple times
    const clonedResponse = response.clone();

    // Store metadata
    if (!clonedResponse._fetchMetadata) {
      clonedResponse._fetchMetadata = {
        url: finalUrl,
        cacheKey: cacheKey,
        timestamp: Date.now()
      };
    }

    return clonedResponse;
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
   * @param {Response} response - The response object
   * @param {Object} options - Original fetch options
   * @return {boolean} Whether to cache
   */
  shouldCache_(response, options) {
    const method = (options.method || 'GET').toUpperCase();
    if (options.cache === 'no-store' || method !== 'GET') {
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
   * @return {Response|null} Cached response or null
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
   * @param {Response} response - The response to cache
   * @param {number} duration - Cache duration in seconds
   */
  setCachedResponse_(cacheKey, response, duration) {
    this.requestCache_.set(cacheKey, {
      response: response.clone(),
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
        averageTime: 0
      });
    }

    const stats = this.analytics_.get(cacheKey);
    stats.requests++;

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

module.exports = FetchingNode;
