/**
 * @fileoverview API-based cache implementation that proxies requests to a remote caching service.
 * Allows client applications to consume backend caching API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements cache operations via HTTP API calls to a remote service.
 * Provides methods for storing, retrieving, and deleting cached values through REST endpoints.
 * @class
 */
class CacheApi {
  /**
   * Initializes the API cache client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 5000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for cache events.
   */
  constructor(options = {}, eventEmitter) {

 this.settings = {};

     this.settings.description = "The distributed caching module requires api connections"
     this.settings.list = [
       {setting: "url", type: "string", values : ['e.g. http:/logging.com']},
       {setting: "apikey", type: "string", values : ['Please speak to you admin for this key']}
     ];
     this.settings.api = options.api || 'http://localhost:3000';
     this.settings.apikey = options.apiKey || '';
     this.timeout = options.timeout || 5000;

     this.eventEmitter_ = eventEmitter;
     this.instanceName_ = (options && options.instanceName) || 'default';

     // Configure axios instance
     this.client = axios.create({
       baseURL: this.settings.api,
       timeout: this.timeout,
       headers: this.settings.apikey ? { 'X-API-Key': this.settings.apikey } : {}
     });

  }

  /**
   * Retrieves all current configuration settings for the cache API provider.
   * Returns the settings object including API URL, API key, timeout, and instance name.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Description of the provider
   *   - list: {Array} Array of configurable settings definitions
   *   - api: {string} The API root URL
   *   - apikey: {string} The API key for authentication
   *   - timeout: {number} Request timeout in milliseconds
   *
   * @example
   * const cacheApi = new CacheApi({ apiRoot: 'http://api.example.com', apiKey: 'secret' });
   * const settings = await cacheApi.getSettings();
   * console.log(settings.api); // 'http://api.example.com'
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Updates configuration settings for the cache API provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   * Emits 'cache:setting-changed' events for each successfully updated setting.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.url] The new API root URL
   * @param {string} [settings.apikey] The new API key for authentication
   * @param {number} [settings.timeout] The new request timeout in milliseconds
   * @return {Promise<void>} A promise that resolves when all settings are updated
   *
   * @example
   * // Update cache API timeout setting
   * await cacheApi.saveSettings({
   *   timeout: 10000,
   *   url: 'http://cache-api.internal.service'
   * });
   */
  async saveSettings(settings){
    for (let i=0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting]
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('cache:setting-changed', {
            setting: this.settings.list[i].setting,
            value: settings[this.settings.list[i].setting]
          });
        }
      }
    }
  }

  /**
   * Validates that a cache key is a non-empty string.
   * @param {string} key The key to validate.
   * @param {string} method The calling method name for error context.
   * @throws {Error} When key is invalid.
   * @private
   */
  validateKey_(key, method) {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      const error = new Error('Invalid key: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`cache:validation-error:${this.instanceName_}`, {
          method,
          error: error.message,
          key
        });
      }
      throw error;
    }
  }

  /**
   * Stores a value in the remote cache via HTTP API.
   * Makes a POST request to the cache service to store the provided value under the given key.
   * The operation is atomic and fails if the API is unreachable.
   *
   * @param {string} key The cache key under which to store the value. Must not be empty.
   * @param {*} value The value to store. Can be any serializable JavaScript value (object, string, number, etc.)
   * @return {Promise<void>} A promise that resolves when the value is successfully stored
   * @throws {Error} When the HTTP request fails (network error, timeout, API error)
   *
   * @example
   * // Store a user object in cache
   * const user = { id: 123, name: 'Alice', email: 'alice@example.com' };
   * await cacheApi.put('user:123', user);
   *
   * @example
   * // Store a simple string value
   * await cacheApi.put('greeting:en', 'Hello, World!');
   */
  async put(key, value) {
    this.validateKey_(key, 'put');
    if (value === undefined) {
      throw new Error('Invalid value: cannot be undefined');
    }
    try {
      await this.client.post(`/services/caching/api/put/${encodeURIComponent(key)}`, value);
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`cache:put:${this.instanceName_}`, { key, value, instance: this.instanceName_ });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:error', { operation: 'put', key, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves a value from the remote cache via HTTP API.
   * Makes a GET request to fetch the value associated with the provided key.
   * Returns undefined if the key does not exist in the cache.
   *
   * @param {string} key The cache key to retrieve. Must not be empty.
   * @return {Promise<*>} A promise that resolves to the cached value, or undefined if the key is not found
   * @throws {Error} When the HTTP request fails (network error, timeout, API error)
   *
   * @example
   * // Retrieve a user object from cache
   * const user = await cacheApi.get('user:123');
   * if (user) {
   *   console.log(`Found user: ${user.name}`);
   * }
   *
   * @example
   * // Retrieve with error handling
   * try {
   *   const value = await cacheApi.get('settings:theme');
   * } catch (error) {
   *   console.error('Cache retrieval failed:', error.message);
   *   // Fall back to default value
   *   const value = 'light';
   * }
   */
  async get(key) {
    this.validateKey_(key, 'get');
    try {
      const response = await this.client.get(`/services/caching/api/get/${encodeURIComponent(key)}`);
      const value = response.data;
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`cache:get:${this.instanceName_}`, { key, value, instance: this.instanceName_ });
      return value;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:error', { operation: 'get', key, error: error.message });
      throw error;
    }
  }

  /**
   * Removes a value from the remote cache via HTTP API.
   * Makes a DELETE request to remove the entry associated with the provided key.
   * If the key does not exist, the operation still succeeds (no error is thrown).
   *
   * @param {string} key The cache key to delete. Must not be empty.
   * @return {Promise<void>} A promise that resolves when the key is successfully removed
   * @throws {Error} When the HTTP request fails (network error, timeout, API error)
   *
   * @example
   * // Delete a user from cache
   * await cacheApi.delete('user:123');
   *
   * @example
   * // Delete multiple related cache entries
   * await Promise.all([
   *   cacheApi.delete('user:123'),
   *   cacheApi.delete('user:123:preferences'),
   *   cacheApi.delete('user:123:sessions')
   * ]);
   */
  async delete(key) {
    this.validateKey_(key, 'delete');
    try {
      await this.client.delete(`/services/caching/api/delete/${encodeURIComponent(key)}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`cache:delete:${this.instanceName_}`, { key, instance: this.instanceName_ });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:error', { operation: 'delete', key, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves analytics data from the remote cache service.
   * Returns statistics about cached items including hit counts, last access times, and other metrics.
   * Useful for monitoring cache performance and identifying frequently accessed items.
   *
   * @return {Promise<Array>} A promise that resolves to an array of analytics entries, each containing:
   *   - key: {string} The cache key
   *   - hits: {number} Number of times this key has been accessed
   *   - lastHit: {string} ISO timestamp of the last access
   *   - size: {number} Approximate size of the value in bytes
   * @throws {Error} When the HTTP request fails (network error, timeout, API error)
   *
   * @example
   * // Get cache analytics to monitor performance
   * const analytics = await cacheApi.getAnalytics();
   * console.log(`Total cached items: ${analytics.length}`);
   * const topItem = analytics.reduce((max, item) =>
   *   item.hits > max.hits ? item : max
   * );
   * console.log(`Most accessed key: ${topItem.key} (${topItem.hits} hits)`);
   */
  async getAnalytics() {
    try {
      const response = await this.client.get('/services/caching/api/list');
      return response.data.data || [];
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:error', { operation: 'getAnalytics', error: error.message });
      throw error;
    }
  }
}

module.exports = CacheApi;
