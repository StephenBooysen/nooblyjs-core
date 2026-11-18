/**
 * @fileoverview API-based measuring service implementation that proxies requests to a remote measuring service.
 * Allows client applications to consume backend measuring API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements metrics and measurement operations via HTTP API calls to a remote service.
 * Provides methods for tracking metrics, counters, and gauges through REST endpoints.
 * @class
 */
class MeasuringApi {
  /**
   * Initializes the Measuring API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 5000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for measuring events.
   */
  constructor(options = {}, eventEmitter) {
    this.apiRoot = options.apiRoot || options.api || 'http://localhost:3000';
    this.apiKey = options.apiKey || null;
    this.timeout = options.timeout || 5000;
    this.eventEmitter_ = eventEmitter;

    // Initialize logger from dependencies
    const { dependencies = {} } = options;
    /** @private */
    this.logger = dependencies.logging || null;

    // Configure axios instance
    this.client = axios.create({
      baseURL: this.apiRoot,
      timeout: this.timeout,
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });

    // Settings for measuring API provider
    this.settings = {};
    this.settings.description = "Configuration settings for the Measuring API Provider";
    this.settings.list = [
      {setting: "url", type: "string", values: ["http://localhost:3000"]},
      {setting: "timeout", type: "number", values: [5000]},
      {setting: "retryLimit", type: "number", values: [3]}
    ];
    this.settings.url = this.apiRoot;
    this.settings.timeout = this.timeout;
    this.settings.retryLimit = options.retryLimit || this.settings.list[2].values[0];
  }

  /**
   * Increments a counter metric via the remote measuring service.
   * Atomically increments a named counter by a specified amount for tracking frequencies and counts.
   * Does not throw on error; errors are emitted as events only.
   *
   * @param {string} name The counter name/identifier. Must be globally unique or namespaced appropriately.
   * @param {number} [value=1] The amount to increment. Defaults to 1 if not provided.
   * @param {Object} [tags] Optional tags for metric categorization:
   *   - service: {string} Service name
   *   - environment: {string} Environment identifier (prod, staging, dev)
   *   - Any other key-value pairs for filtering and grouping
   * @return {Promise<void>} A promise that resolves when the counter is incremented (or silently fails)
   *
   * @example
   * // Increment a simple counter
   * await measuringApi.increment('user.registrations');
   *
   * @example
   * // Increment with custom amount and tags
   * await measuringApi.increment('orders.processed', 5, {
   *   service: 'checkout',
   *   environment: 'production'
   * });
   */
  async increment(name, value = 1, tags = {}) {
    try {
      await this.client.post('/services/measuring/api/increment', { name, value, tags });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:increment', { name, value });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:error', { operation: 'increment', name, error: error.message });
    }
  }

  /**
   * Records a gauge metric via the remote measuring service.
   * Records a single value at a point in time for metrics that represent instantaneous state (e.g., memory usage, active connections).
   * Does not throw on error; errors are emitted as events only.
   *
   * @param {string} name The gauge name/identifier for the metric
   * @param {number} value The numeric value to record (can be negative)
   * @param {Object} [tags] Optional tags for metric categorization and grouping
   * @return {Promise<void>} A promise that resolves when the gauge is recorded (or silently fails)
   *
   * @example
   * // Record memory usage
   * const memUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
   * await measuringApi.gauge('system.memory.heap_mb', memUsage);
   *
   * @example
   * // Record with tags
   * await measuringApi.gauge('database.connections.active', 42, {
   *   database: 'postgresql',
   *   pool: 'main'
   * });
   */
  async gauge(name, value, tags = {}) {
    try {
      await this.client.post('/services/measuring/api/gauge', { name, value, tags });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:gauge', { name, value });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:error', { operation: 'gauge', name, error: error.message });
    }
  }

  /**
   * Records a timing/duration metric via the remote measuring service.
   * Records how long an operation took for performance analysis and latency tracking.
   * Does not throw on error; errors are emitted as events only.
   *
   * @param {string} name The timing metric name/identifier
   * @param {number} duration The duration in milliseconds. Must be non-negative.
   * @param {Object} [tags] Optional tags for categorizing timing data:
   *   - operation: {string} The operation type
   *   - endpoint: {string} API endpoint
   *   - status: {string} Result status (success, error, timeout)
   * @return {Promise<void>} A promise that resolves when the timing is recorded (or silently fails)
   *
   * @example
   * // Record API response time
   * const start = Date.now();
   * const response = await fetchData();
   * const duration = Date.now() - start;
   * await measuringApi.timing('api.response.time_ms', duration, {
   *   endpoint: '/users',
   *   status: 'success'
   * });
   */
  async timing(name, duration, tags = {}) {
    try {
      await this.client.post('/services/measuring/api/timing', { name, duration, tags });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:timing', { name, duration });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:error', { operation: 'timing', name, error: error.message });
    }
  }

  /**
   * Records a histogram value via the remote measuring service.
   * Records numerical values that will be collected into distribution buckets for statistical analysis.
   * Useful for tracking request sizes, response times across many requests, etc.
   * Does not throw on error; errors are emitted as events only.
   *
   * @param {string} name The histogram name/identifier
   * @param {number} value The numeric value to record in the histogram
   * @param {Object} [tags] Optional tags for histogram categorization
   * @return {Promise<void>} A promise that resolves when the value is recorded (or silently fails)
   *
   * @example
   * // Record request payload sizes
   * const payloadSize = JSON.stringify(requestBody).length;
   * await measuringApi.histogram('request.payload_bytes', payloadSize);
   */
  async histogram(name, value, tags = {}) {
    try {
      await this.client.post('/services/measuring/api/histogram', { name, value, tags });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:histogram', { name, value });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:error', { operation: 'histogram', name, error: error.message });
    }
  }

  /**
   * Retrieves all collected metrics from the remote measuring service.
   * Returns current state of all counters, gauges, timings, and histograms.
   *
   * @return {Promise<Object>} A promise that resolves to the metrics object containing:
   *   - counters: {Object} All counter values keyed by name
   *   - gauges: {Object} All gauge values keyed by name
   *   - timings: {Array} Array of timing metric statistics
   *   - histograms: {Array} Array of histogram statistics
   *   - timestamp: {string} ISO timestamp when metrics were collected
   * @throws {Error} When the HTTP request fails
   *
   * @example
   * // Retrieve all metrics for monitoring/alerting
   * const metrics = await measuringApi.getMetrics();
   * console.log(`Total requests: ${metrics.counters['requests.total']}`);
   */
  async getMetrics() {
    try {
      const response = await this.client.get('/services/measuring/api/metrics');
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('measuring:error', { operation: 'getMetrics', error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves all current configuration settings for the measuring API provider.
   * Returns the settings object including API URL, timeout, and retry configuration.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Description of the provider
   *   - list: {Array} Array of configurable settings definitions
   *   - apiUrl: {string} The remote API URL
   *   - timeout: {number} Request timeout in milliseconds
   *   - retryLimit: {number} Maximum number of retry attempts
   *
   * @example
   * const settings = await measuringApi.getSettings();
   * console.log(`API URL: ${settings.apiUrl}`);
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Updates configuration settings for the measuring API provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.apiUrl] The new remote API URL
   * @param {number} [settings.timeout] The new request timeout in milliseconds
   * @param {number} [settings.retryLimit] The new retry limit
   * @return {Promise<void>} A promise that resolves when all settings are updated
   *
   * @example
   * // Update API timeout
   * await measuringApi.saveSettings({
   *   timeout: 8000,
   *   apiUrl: 'https://metrics-api.internal.service'
   * });
   */
  async saveSettings(settings){
    for (let i = 0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${this.settings.list[i].setting}`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting]
        });
      }
    }
    // Rebuild axios client if URL or timeout changed
    if (settings.url || settings.timeout) {
      this.apiRoot = this.settings.url;
      this.timeout = this.settings.timeout;
      this.client = axios.create({
        baseURL: this.apiRoot,
        timeout: this.timeout,
        headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
      });
    }
  }
}

module.exports = MeasuringApi;
