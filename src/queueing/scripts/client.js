/**
 * @fileoverview nooblyjs-core Queueing JavaScript Client Library
 * Client-side library for interacting with the queueing service from web applications.
 * Provides a simple interface for enqueue and dequeue operations.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

/**
 * LocalQueue - In-memory FIFO queue for client-side storage
 * Provides FIFO queue operations without server communication
 *
 * @private
 */
class LocalQueue {
  constructor() {
    /**
     * @type {Map<string, Array>} - Map of queue names to their items
     * @private
     */
    this.queues = new Map();
  }

  /**
   * Enqueue an item to a queue
   * @param {string} queueName - Name of the queue
   * @param {*} item - Item to enqueue
   */
  enqueue(queueName, item) {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }
    this.queues.get(queueName).push(item);
  }

  /**
   * Dequeue an item from a queue (FIFO)
   * @param {string} queueName - Name of the queue
   * @returns {*} The dequeued item or undefined if queue is empty
   */
  dequeue(queueName) {
    if (!this.queues.has(queueName)) {
      return undefined;
    }
    const queue = this.queues.get(queueName);
    return queue.length > 0 ? queue.shift() : undefined;
  }

  /**
   * Get the size of a queue
   * @param {string} queueName - Name of the queue
   * @returns {number} Number of items in the queue
   */
  size(queueName) {
    if (!this.queues.has(queueName)) {
      return 0;
    }
    return this.queues.get(queueName).length;
  }

  /**
   * Get all queue names
   * @returns {Array<string>} Array of queue names
   */
  listQueues() {
    return Array.from(this.queues.keys());
  }

  /**
   * Purge all items from a queue
   * @param {string} queueName - Name of the queue
   */
  purge(queueName) {
    if (this.queues.has(queueName)) {
      this.queues.get(queueName).length = 0;
    }
  }

  /**
   * Clear all queues
   */
  clearAll() {
    this.queues.clear();
  }
}

/**
 * nooblyjs-core Queueing Service Client
 *
 * Provides a JavaScript client for consuming the queueing service API from browser applications.
 * Supports both local (in-memory) queues and remote server-side instances.
 *
 * When no instance name is provided, uses local in-memory queues.
 * When an instance name is provided, connects to the remote server API.
 *
 * @example
 * // Create a local queueing client (no server needed)
 * let localQueue = new nooblyjsqueueing();
 *
 * // Enqueue an item
 * let item = {data: {userId: 123, action: 'process'}};
 * localQueue.enqueue('tasks', item)
 *   .then(function() {
 *     console.log('Item enqueued locally');
 *   });
 *
 * // Create a remote queueing client
 * let remoteQueue = new nooblyjsqueueing('default');
 *
 * // Dequeue an item from remote queue
 * remoteQueue.dequeue('tasks')
 *   .then(function(item) {
 *     console.log('Dequeued item:', item);
 *   });
 */
class nooblyjsqueueing {
  /**
   * Initializes a new Queueing Service client instance.
   *
   * When no instanceName is provided, uses local in-memory queues (no server needed).
   * When instanceName is provided, connects to the remote server API.
   *
   * @param {string} [instanceName] - The name of the queue instance to connect to.
   *                                  If not provided or undefined, uses local queue.
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.apiKey] - Optional API key for authentication
   * @param {boolean} [options.debug=false] - Enable debug logging
   * @throws {TypeError} If instanceName is provided but is not a string
   */
  constructor(instanceName, options = {}) {
    if (instanceName && typeof instanceName !== 'string') {
      throw new TypeError('instanceName must be a string');
    }

    /**
     * Determine if using local or remote mode
     * Local mode: no instanceName provided (undefined or null)
     * Remote mode: instanceName provided
     * @type {boolean}
     * @private
     */
    this.isLocal = !instanceName;

    /**
     * @type {string}
     * @private
     */
    this.instanceName = instanceName || 'local';

    /**
     * @type {Object}
     * @private
     */
    this.options = {
      apiKey: options.apiKey || null,
      debug: options.debug || false,
      ...options
    };

    /**
     * Local queue storage for client-side queueing
     * @type {LocalQueue|null}
     * @private
     */
    this.localQueue = this.isLocal ? new LocalQueue() : null;

    /**
     * @type {string}
     * @private
     */
    this.baseUrl = this.getBaseUrl();

    if (this.options.debug) {
      if (this.isLocal) {
        console.log('[nooblyjsqueueing] Initialized in LOCAL mode');
      } else {
        console.log('[nooblyjsqueueing] Initialized with remote instance:', this.instanceName);
        console.log('[nooblyjsqueueing] Base URL:', this.baseUrl);
      }
    }
  }

  /**
   * Get the base URL for the queueing API
   * For local mode, returns empty string (no API calls needed)
   * For remote mode, returns the API endpoint URL
   *
   * @private
   * @returns {string} The base URL for API calls (empty string for local mode)
   */
  getBaseUrl() {
    if (this.isLocal) {
      return ''; // No API calls for local mode
    }
    if (this.instanceName === 'default' || !this.instanceName) {
      return '/services/queueing/api';
    }
    return `/services/queueing/api/${this.instanceName}`;
  }

  /**
   * Make a fetch request to the queueing API
   *
   * @private
   * @param {string} endpoint - The API endpoint
   * @param {string} method - HTTP method (GET, POST, DELETE)
   * @param {*} body - Optional request body
   * @returns {Promise<*>} The response data
   * @throws {Error} If the API request fails
   */
  async request(endpoint, method = 'GET', body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (this.options.apiKey) {
      options.headers['X-API-Key'] = this.options.apiKey;
    }

    if (body) {
      options.body = JSON.stringify(body);
    }

    if (this.options.debug) {
      console.log('[nooblyjsqueueing] Request:', method, url, body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      // Handle different response types
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text();
      }
    } catch (error) {
      if (this.options.debug) {
        console.error('[nooblyjsqueueing] Request failed:', error);
      }
      throw error;
    }
  }

  /**
   * Enqueues an item to the specified queue
   *
   * @param {string} queueName - The name of the queue
   * @param {*} object_to_be_queued - The object to add to the queue
   * @returns {Promise<void>} Promise that resolves when the item is enqueued
   * @throws {Error} If the queue name is missing or the API request fails
   *
   * @example
   * queueClient.enqueue('tasks', {userId: 123, action: 'process'})
   *   .then(() => console.log('Enqueued'))
   *   .catch(err => console.error(err));
   */
  async enqueue(queueName, object_to_be_queued) {
    if (!queueName) {
      throw new Error('Queue name is required');
    }

    if (object_to_be_queued === undefined) {
      throw new Error('Object to be queued is required');
    }

    if (this.isLocal) {
      // Local mode: store in-memory
      this.localQueue.enqueue(queueName, object_to_be_queued);
      if (this.options.debug) {
        console.log('[nooblyjsqueueing] Local enqueue:', queueName, object_to_be_queued);
      }
      return Promise.resolve();
    }

    // Remote mode: send to server
    const endpoint = `/enqueue/${encodeURIComponent(queueName)}`;
    return await this.request(endpoint, 'POST', { task: object_to_be_queued });
  }

  /**
   * Dequeues and returns the next item from the specified queue
   *
   * @param {string} queueName - The name of the queue
   * @returns {Promise<*>} Promise that resolves to the dequeued object, or undefined if queue is empty
   * @throws {Error} If the queue name is missing or the API request fails
   *
   * @example
   * queueClient.dequeue('tasks')
   *   .then(item => console.log('Dequeued:', item))
   *   .catch(err => console.error(err));
   */
  async dequeue(queueName) {
    if (!queueName) {
      throw new Error('Queue name is required');
    }

    if (this.isLocal) {
      // Local mode: get from in-memory queue
      const item = this.localQueue.dequeue(queueName);
      if (this.options.debug) {
        console.log('[nooblyjsqueueing] Local dequeue:', queueName, item);
      }
      return Promise.resolve(item);
    }

    // Remote mode: fetch from server
    const endpoint = `/dequeue/${encodeURIComponent(queueName)}`;
    return await this.request(endpoint, 'GET');
  }

  /**
   * Gets the current size of the specified queue
   *
   * @param {string} queueName - The name of the queue
   * @returns {Promise<number>} Promise that resolves to the queue size
   * @throws {Error} If the queue name is missing or the API request fails
   *
   * @example
   * queueClient.size('tasks')
   *   .then(size => console.log('Queue size:', size))
   *   .catch(err => console.error(err));
   */
  async size(queueName) {
    if (!queueName) {
      throw new Error('Queue name is required');
    }

    if (this.isLocal) {
      // Local mode: get size from in-memory queue
      const queueSize = this.localQueue.size(queueName);
      if (this.options.debug) {
        console.log('[nooblyjsqueueing] Local size:', queueName, queueSize);
      }
      return Promise.resolve(queueSize);
    }

    // Remote mode: fetch from server
    const endpoint = `/size/${encodeURIComponent(queueName)}`;
    return await this.request(endpoint, 'GET');
  }

  /**
   * Gets a list of all queue names in this instance
   *
   * @returns {Promise<Array<string>>} Promise that resolves to array of queue names
   * @throws {Error} If the API request fails
   *
   * @example
   * queueClient.listQueues()
   *   .then(queues => console.log('Available queues:', queues))
   *   .catch(err => console.error(err));
   */
  async listQueues() {
    if (this.isLocal) {
      // Local mode: get queues from in-memory storage
      const queues = this.localQueue.listQueues();
      if (this.options.debug) {
        console.log('[nooblyjsqueueing] Local listQueues:', queues);
      }
      return Promise.resolve(queues);
    }

    // Remote mode: fetch from server
    const endpoint = '/queues';
    return await this.request(endpoint, 'GET');
  }

  /**
   * Purges all items from the specified queue
   *
   * @param {string} queueName - The name of the queue to purge
   * @returns {Promise<void>} Promise that resolves when the queue is purged
   * @throws {Error} If the queue name is missing or the API request fails
   *
   * @example
   * queueClient.purge('tasks')
   *   .then(() => console.log('Queue purged'))
   *   .catch(err => console.error(err));
   */
  async purge(queueName) {
    if (!queueName) {
      throw new Error('Queue name is required');
    }

    if (this.isLocal) {
      // Local mode: purge from in-memory queue
      this.localQueue.purge(queueName);
      if (this.options.debug) {
        console.log('[nooblyjsqueueing] Local purge:', queueName);
      }
      return Promise.resolve();
    }

    // Remote mode: send to server
    const endpoint = `/purge/${encodeURIComponent(queueName)}`;
    return await this.request(endpoint, 'DELETE');
  }

  /**
   * Gets analytics data for this queue instance
   *
   * @returns {Promise<Object>} Promise that resolves to analytics data
   * @throws {Error} If the API request fails
   *
   * @example
   * queueClient.getAnalytics()
   *   .then(analytics => console.log('Analytics:', analytics))
   *   .catch(err => console.error(err));
   */
  async getAnalytics() {
    const endpoint = '/analytics';
    return await this.request(endpoint, 'GET');
  }

  /**
   * Gets the settings for this queue instance
   *
   * @returns {Promise<Object>} Promise that resolves to settings object
   * @throws {Error} If the API request fails
   *
   * @example
   * queueClient.getSettings()
   *   .then(settings => console.log('Settings:', settings))
   *   .catch(err => console.error(err));
   */
  async getSettings() {
    const endpoint = '/settings';
    return await this.request(endpoint, 'GET');
  }

  /**
   * Saves settings for this queue instance
   *
   * @param {Object} settings - Settings object to save
   * @returns {Promise<void>} Promise that resolves when settings are saved
   * @throws {Error} If the settings are invalid or the API request fails
   *
   * @example
   * queueClient.saveSettings({maxSize: 1000})
   *   .then(() => console.log('Settings saved'))
   *   .catch(err => console.error(err));
   */
  async saveSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Settings must be a non-null object');
    }

    const endpoint = '/settings';
    return await this.request(endpoint, 'POST', settings);
  }
}

// Export for use in browser or Node.js environments
if (typeof window !== 'undefined') {
  // Browser environment - attach to window object
  window.nooblyjsqueueing = nooblyjsqueueing;
}

if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS environment
  module.exports = nooblyjsqueueing;
}
