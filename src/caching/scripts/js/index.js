/**
 * @fileoverview NooblyJS Core Caching Client Library
 * A client-side JavaScript library for interacting with the NooblyJS Core caching service.
 * This library provides a simple, intuitive API for caching operations from web applications.
 * Includes both remote (server-side) and local (client-side) cache implementations.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.15
 *
 * @example
 * // Include the library in your HTML
 * <script src="/services/caching/scripts"></script>
 *
 * // Create a local cache instance (client-side only)
 * const localCache = new nooblyjsCaching();
 *
 * // Create a remote cache instance (server-side)
 * const remoteCache = new nooblyjsCaching({ instanceName: 'default' });
 *
 * // Store data in cache
 * localCache.put('user:123', { name: 'John', age: 30 });
 * remoteCache.put('user:456', { name: 'Jane', age: 25 });
 *
 * // Retrieve data from cache
 * localCache.get('user:123').then(data => {
 *   console.log(data); // { name: 'John', age: 30 }
 * });
 *
 * // Delete data from cache
 * localCache.delete('user:123');
 *
 * // Check if key exists
 * localCache.exists('user:123').then(exists => {
 *   console.log(exists); // true or false
 * });
 */

(function(global) {
  'use strict';

  /**
   * Local Client-Side Cache Implementation
   * Simple in-memory key-value store for client-side caching
   *
   * @class LocalCache
   * @private
   */
  function LocalCache() {
    this.store = {};
    this.created = Date.now();
  }

  /**
   * Store a value in the local cache
   * @param {string} key - The cache key
   * @param {*} value - The value to store
   * @private
   */
  LocalCache.prototype.put = function(key, value) {
    this.store[key] = {
      value: value,
      timestamp: Date.now()
    };
  };

  /**
   * Retrieve a value from the local cache
   * @param {string} key - The cache key
   * @returns {*} The cached value or undefined if not found
   * @private
   */
  LocalCache.prototype.get = function(key) {
    const entry = this.store[key];
    return entry ? entry.value : undefined;
  };

  /**
   * Check if a key exists in the local cache
   * @param {string} key - The cache key
   * @returns {boolean} True if key exists, false otherwise
   * @private
   */
  LocalCache.prototype.exists = function(key) {
    return key in this.store;
  };

  /**
   * Delete a value from the local cache
   * @param {string} key - The cache key
   * @private
   */
  LocalCache.prototype.delete = function(key) {
    delete this.store[key];
  };

  /**
   * Get all keys in the local cache
   * @returns {Array<string>} Array of all keys
   * @private
   */
  LocalCache.prototype.keys = function() {
    return Object.keys(this.store);
  };

  /**
   * Get the size of the local cache
   * @returns {number} Number of entries in the cache
   * @private
   */
  LocalCache.prototype.size = function() {
    return Object.keys(this.store).length;
  };

  /**
   * Clear all entries from the local cache
   * @private
   */
  LocalCache.prototype.clear = function() {
    this.store = {};
  };

  /**
   * Get analytics about the local cache
   * @returns {Object} Analytics object with size and keys info
   * @private
   */
  LocalCache.prototype.getAnalytics = function() {
    return {
      type: 'local',
      size: this.size(),
      keys: this.keys(),
      uptime: Date.now() - this.created,
      memoryUsage: JSON.stringify(this.store).length + ' bytes'
    };
  };

  /**
   * NooblyJS Caching Client Library
   * Provides client-side access to both local and remote caching service APIs
   *
   * @class nooblyjsCaching
   * @param {Object} options - Configuration options
   * @param {string} options.instanceName - Optional cache instance name. If not provided, uses local client-side cache
   * @param {string} options.baseUrl - Optional base URL for API calls (default: window.location.origin)
   * @param {boolean} options.debug - Enable debug logging (default: false)
   * @param {number} options.timeout - Request timeout in milliseconds (default: 5000)
   */
  function nooblyjsCaching(options = {}) {
    // If no instanceName is provided, use local client-side cache
    if (!options.instanceName) {
      this.isLocal = true;
      this.instanceName = 'local';
      this.localCache = new LocalCache();
    } else {
      this.isLocal = false;
      this.instanceName = options.instanceName;
      this.baseUrl = options.baseUrl || window.location.origin;
      this.apiBase = this.buildApiBase();
    }

    this.debug = options.debug || false;
    this.timeout = options.timeout || 5000;
  }

  /**
   * Build the base API URL for the cache instance
   * @private
   * @returns {string} The base API URL
   */
  nooblyjsCaching.prototype.buildApiBase = function() {
    if (this.isLocal) {
      return null; // Local cache doesn't use API URLs
    }
    if (this.instanceName === 'default') {
      return `${this.baseUrl}/services/caching/api`;
    }
    return `${this.baseUrl}/services/caching/api/${this.instanceName}`;
  };

  /**
   * Log a debug message if debugging is enabled
   * @private
   * @param {string} message - The message to log
   * @param {*} data - Optional data to log
   */
  nooblyjsCaching.prototype.log = function(message, data) {
    if (this.debug) {
      if (data !== undefined) {
        console.log(`[nooblyjsCaching:${this.instanceName}] ${message}`, data);
      } else {
        console.log(`[nooblyjsCaching:${this.instanceName}] ${message}`);
      }
    }
  };

  /**
   * Make a fetch request with error handling and timeout
   * @private
   * @param {string} url - The URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} The fetch response
   */
  nooblyjsCaching.prototype.fetchWithTimeout = function(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    return fetch(url, { ...options, signal: controller.signal })
      .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout after ${this.timeout}ms`);
        }
        throw error;
      });
  };

  /**
   * Store a value in the cache
   * Stores data under the specified key in the cache service.
   * The key can use any string format including hierarchical keys like 'user:123:profile'
   *
   * @param {string} key - The cache key
   * @param {*} value - The value to store (can be any JSON-serializable value)
   * @returns {Promise<void>} A promise that resolves when the value is stored
   * @throws {Error} If the operation fails
   *
   * @example
   * cache.put('user:123', { name: 'John', email: 'john@example.com' })
   *   .then(() => console.log('Stored successfully'))
   *   .catch(err => console.error('Failed to store:', err));
   */
  nooblyjsCaching.prototype.put = function(key, value) {
    if (!key || typeof key !== 'string') {
      return Promise.reject(new Error('Key must be a non-empty string'));
    }

    this.log(`Storing key: ${key}`);

    // Use local cache if no instanceName was provided
    if (this.isLocal) {
      try {
        this.localCache.put(key, value);
        this.log(`Successfully stored key: ${key}`);
        return Promise.resolve();
      } catch (error) {
        this.log(`Failed to store key: ${key}`, error.message);
        return Promise.reject(error);
      }
    }

    // Otherwise use remote API
    const url = `${this.apiBase}/put/${encodeURIComponent(key)}`;

    return this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(value)
    })
      .then(response => {
        this.log(`Successfully stored key: ${key}`);
        return response.text();
      })
      .catch(error => {
        this.log(`Failed to store key: ${key}`, error.message);
        throw error;
      });
  };

  /**
   * Retrieve a value from the cache
   * Retrieves data stored under the specified key from the cache service.
   * Returns null or undefined if the key does not exist.
   *
   * @param {string} key - The cache key to retrieve
   * @returns {Promise<*>} A promise that resolves with the cached value
   * @throws {Error} If the operation fails
   *
   * @example
   * cache.get('user:123')
   *   .then(data => {
   *     console.log('Retrieved:', data); // { name: 'John', email: 'john@example.com' }
   *   })
   *   .catch(err => console.error('Failed to retrieve:', err));
   */
  nooblyjsCaching.prototype.get = function(key) {
    if (!key || typeof key !== 'string') {
      return Promise.reject(new Error('Key must be a non-empty string'));
    }

    this.log(`Retrieving key: ${key}`);

    // Use local cache if no instanceName was provided
    if (this.isLocal) {
      try {
        const value = this.localCache.get(key);
        this.log(`Successfully retrieved key: ${key}`, value);
        return Promise.resolve(value);
      } catch (error) {
        this.log(`Failed to retrieve key: ${key}`, error.message);
        return Promise.reject(error);
      }
    }

    // Otherwise use remote API
    const url = `${this.apiBase}/get/${encodeURIComponent(key)}`;

    return this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    })
      .then(response => response.json())
      .then(data => {
        this.log(`Successfully retrieved key: ${key}`, data);
        return data;
      })
      .catch(error => {
        this.log(`Failed to retrieve key: ${key}`, error.message);
        throw error;
      });
  };

  /**
   * Delete a value from the cache
   * Removes the data stored under the specified key from the cache service.
   * Does not throw an error if the key doesn't exist.
   *
   * @param {string} key - The cache key to delete
   * @returns {Promise<void>} A promise that resolves when the value is deleted
   * @throws {Error} If the operation fails
   *
   * @example
   * cache.delete('user:123')
   *   .then(() => console.log('Deleted successfully'))
   *   .catch(err => console.error('Failed to delete:', err));
   */
  nooblyjsCaching.prototype.delete = function(key) {
    if (!key || typeof key !== 'string') {
      return Promise.reject(new Error('Key must be a non-empty string'));
    }

    this.log(`Deleting key: ${key}`);

    // Use local cache if no instanceName was provided
    if (this.isLocal) {
      try {
        this.localCache.delete(key);
        this.log(`Successfully deleted key: ${key}`);
        return Promise.resolve();
      } catch (error) {
        this.log(`Failed to delete key: ${key}`, error.message);
        return Promise.reject(error);
      }
    }

    // Otherwise use remote API
    const url = `${this.apiBase}/delete/${encodeURIComponent(key)}`;

    return this.fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    })
      .then(response => {
        this.log(`Successfully deleted key: ${key}`);
        return response.text();
      })
      .catch(error => {
        this.log(`Failed to delete key: ${key}`, error.message);
        throw error;
      });
  };

  /**
   * Check if a key exists in the cache
   * Checks if a key exists in the cache (works for both local and remote).
   *
   * @param {string} key - The cache key to check
   * @returns {Promise<boolean>} A promise that resolves with true if key exists, false otherwise
   *
   * @example
   * cache.exists('user:123')
   *   .then(exists => {
   *     console.log(exists ? 'Key exists' : 'Key does not exist');
   *   });
   */
  nooblyjsCaching.prototype.exists = function(key) {
    // Use local cache if no instanceName was provided
    if (this.isLocal) {
      return Promise.resolve(this.localCache.exists(key));
    }

    // Otherwise use remote API via get
    return this.get(key)
      .then(value => value !== null && value !== undefined)
      .catch(() => false);
  };

  /**
   * Get cache service status
   * For local cache, returns the local cache status. For remote, checks if the service is accessible.
   *
   * @returns {Promise<Object>} A promise that resolves with the status message
   * @throws {Error} If the operation fails
   *
   * @example
   * cache.status()
   *   .then(status => console.log('Status:', status))
   *   .catch(err => console.error('Failed to get status:', err));
   */
  nooblyjsCaching.prototype.status = function() {
    this.log('Checking cache service status');

    // Return local cache status
    if (this.isLocal) {
      const status = {
        type: 'local',
        status: 'active',
        size: this.localCache.size(),
        keys: this.localCache.keys().length
      };
      this.log('Cache service status:', status);
      return Promise.resolve(status);
    }

    // Otherwise check remote API
    const url = `${this.baseUrl}/services/caching/api/status`;

    return this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    })
      .then(response => response.json())
      .then(status => {
        this.log('Cache service status:', status);
        return status;
      })
      .catch(error => {
        this.log('Failed to get cache service status', error.message);
        throw error;
      });
  };

  /**
   * Get list of available cache instances
   * For local cache, returns only the local instance. For remote, retrieves all configured instances.
   *
   * @returns {Promise<Array>} A promise that resolves with array of instance objects
   * @throws {Error} If the operation fails
   *
   * @example
   * cache.listInstances()
   *   .then(instances => {
   *     console.log('Available instances:', instances);
   *     // [{ name: 'default', provider: 'memory', status: 'active' }, ...]
   *   });
   */
  nooblyjsCaching.prototype.listInstances = function() {
    this.log('Listing available cache instances');

    // Return local instance info
    if (this.isLocal) {
      const instances = [{
        name: 'local',
        provider: 'memory',
        status: 'active',
        type: 'local'
      }];
      this.log('Available instances:', instances);
      return Promise.resolve(instances);
    }

    // Otherwise fetch from remote API
    const url = `${this.baseUrl}/services/caching/api/instances`;

    return this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    })
      .then(response => response.json())
      .then(data => {
        this.log('Available instances:', data.instances);
        return data.instances;
      })
      .catch(error => {
        this.log('Failed to list instances', error.message);
        throw error;
      });
  };

  /**
   * Store multiple values in cache (batch operation)
   * Stores multiple key-value pairs in the cache service.
   *
   * @param {Object} items - Object with key-value pairs to store
   * @returns {Promise<Object>} A promise that resolves with results of each operation
   *
   * @example
   * cache.putBatch({
   *   'user:123': { name: 'John' },
   *   'user:456': { name: 'Jane' },
   *   'config:app': { theme: 'dark' }
   * }).then(results => {
   *   console.log('All items stored');
   * });
   */
  nooblyjsCaching.prototype.putBatch = function(items) {
    if (typeof items !== 'object' || items === null) {
      return Promise.reject(new Error('Items must be an object'));
    }

    const keys = Object.keys(items);
    this.log(`Batch storing ${keys.length} items`);

    const promises = keys.map(key => {
      return this.put(key, items[key])
        .then(() => ({ key, success: true }))
        .catch(error => ({ key, success: false, error: error.message }));
    });

    return Promise.all(promises);
  };

  /**
   * Retrieve multiple values from cache (batch operation)
   * Retrieves multiple values from the cache service.
   *
   * @param {Array<string>} keys - Array of cache keys to retrieve
   * @returns {Promise<Object>} A promise that resolves with object of key-value pairs
   *
   * @example
   * cache.getBatch(['user:123', 'user:456', 'config:app'])
   *   .then(results => {
   *     console.log('Retrieved items:', results);
   *     // { 'user:123': {...}, 'user:456': {...}, 'config:app': {...} }
   *   });
   */
  nooblyjsCaching.prototype.getBatch = function(keys) {
    if (!Array.isArray(keys)) {
      return Promise.reject(new Error('Keys must be an array'));
    }

    this.log(`Batch retrieving ${keys.length} items`);

    const promises = keys.map(key => {
      return this.get(key)
        .then(value => ({ key, value, success: true }))
        .catch(error => ({ key, success: false, error: error.message }));
    });

    return Promise.all(promises)
      .then(results => {
        const output = {};
        results.forEach(result => {
          if (result.success) {
            output[result.key] = result.value;
          }
        });
        return output;
      });
  };

  /**
   * Clear all cache entries (delete multiple keys)
   * Deletes multiple keys from the cache service.
   *
   * @param {Array<string>} keys - Array of cache keys to delete
   * @returns {Promise<Object>} A promise that resolves with results of each deletion
   *
   * @example
   * cache.clear(['user:123', 'user:456', 'config:app'])
   *   .then(results => console.log('Cleared items'));
   */
  nooblyjsCaching.prototype.clear = function(keys) {
    if (!Array.isArray(keys)) {
      return Promise.reject(new Error('Keys must be an array'));
    }

    this.log(`Clearing ${keys.length} items`);

    const promises = keys.map(key => {
      return this.delete(key)
        .then(() => ({ key, success: true }))
        .catch(error => ({ key, success: false, error: error.message }));
    });

    return Promise.all(promises);
  };

  /**
   * Get all keys stored in the cache
   * For local cache, returns all keys. For remote, this is not available.
   *
   * @returns {Promise<Array<string>>} A promise that resolves with array of all keys
   *
   * @example
   * cache.keys()
   *   .then(keys => console.log('All keys:', keys));
   */
  nooblyjsCaching.prototype.keys = function() {
    if (this.isLocal) {
      return Promise.resolve(this.localCache.keys());
    }
    return Promise.reject(new Error('keys() is only available for local cache instances'));
  };

  /**
   * Get the number of entries in the cache
   * For local cache, returns the entry count. For remote, this is not available.
   *
   * @returns {Promise<number>} A promise that resolves with the number of entries
   *
   * @example
   * cache.size()
   *   .then(size => console.log('Cache size:', size));
   */
  nooblyjsCaching.prototype.size = function() {
    if (this.isLocal) {
      return Promise.resolve(this.localCache.size());
    }
    return Promise.reject(new Error('size() is only available for local cache instances'));
  };

  /**
   * Clear all entries from the cache
   * For local cache, clears all entries. For remote, this is not available.
   *
   * @returns {Promise<void>} A promise that resolves when the cache is cleared
   *
   * @example
   * cache.clearAll()
   *   .then(() => console.log('Cache cleared'));
   */
  nooblyjsCaching.prototype.clearAll = function() {
    if (this.isLocal) {
      this.localCache.clear();
      this.log('Cleared all cache entries');
      return Promise.resolve();
    }
    return Promise.reject(new Error('clearAll() is only available for local cache instances'));
  };

  /**
   * Get analytics for the cache
   * For local cache, returns in-memory analytics. For remote, this is not available.
   *
   * @returns {Promise<Object>} A promise that resolves with cache analytics
   *
   * @example
   * cache.getAnalytics()
   *   .then(analytics => console.log('Analytics:', analytics));
   */
  nooblyjsCaching.prototype.getAnalytics = function() {
    if (this.isLocal) {
      return Promise.resolve(this.localCache.getAnalytics());
    }
    return Promise.reject(new Error('getAnalytics() is only available for local cache instances'));
  };

  // Expose the library globally
  global.nooblyjsCaching = nooblyjsCaching;

  // Also support AMD and CommonJS if running in those environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = nooblyjsCaching;
  }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
