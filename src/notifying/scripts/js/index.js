/**
 * NooblyJS Notifying Service - Client-side JavaScript Library
 *
 * A lightweight library for integrating pub/sub messaging capabilities into web applications.
 * Provides both local client-side pub/sub (when no instanceName is provided) and remote
 * server-side integration (when instanceName is specified).
 *
 * @author NooblyJS Core Team
 * @version 1.1.0
 * @license ISC
 *
 * @example
 * // Local client-side pub/sub (no server required)
 * const localNotifying = new nooblyjsNotifying();
 * await localNotifying.createTopic('user-events');
 * localNotifying.subscribe('user-events', (message) => {
 *   console.log('Local message:', message);
 * });
 * await localNotifying.notify('user-events', { type: 'test' });
 *
 * // Remote server-side pub/sub
 * const remoteNotifying = new nooblyjsNotifying({ instanceName: 'production' });
 * await remoteNotifying.createTopic('server-events');
 * remoteNotifying.subscribe('server-events', (message) => {
 *   console.log('Server message:', message);
 * });
 * await remoteNotifying.notify('server-events', { type: 'server-event' });
 */

(function(global) {
  'use strict';

  /**
   * Local Client-side Pub/Sub Service Bus
   * Provides in-memory topic management and event-based subscriptions
   * @constructor
   * @private
   */
  function LocalNotifyingService() {
    this.topics = new Map(); // Maps topic names to arrays of callbacks
    this.subscribers = new Map(); // Maps subscription IDs to subscriber objects
    this.subscriptionCounter = 0;
  }

  /**
   * Create a topic in the local service
   * @param {string} topic - Topic name
   */
  LocalNotifyingService.prototype.createTopic = async function(topic) {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }
    return 'OK';
  };

  /**
   * Subscribe to a topic in the local service
   * @param {string} topic - Topic name
   * @param {Function} callback - Callback function
   * @returns {Object} Subscription details with subscriptionId
   */
  LocalNotifyingService.prototype.subscribe = async function(topic, callback) {
    if (!this.topics.has(topic)) {
      this.topics.set(topic, []);
    }

    const subscriptionId = `local_${topic}_${++this.subscriptionCounter}_${Date.now()}`;

    const subscriber = {
      subscriptionId,
      topic,
      callback
    };

    const topicCallbacks = this.topics.get(topic);
    topicCallbacks.push(subscriber);

    this.subscribers.set(subscriptionId, subscriber);

    return {
      subscriptionId,
      topic,
      status: 'subscribed'
    };
  };

  /**
   * Unsubscribe from a topic in the local service
   * @param {string} topic - Topic name
   * @param {string} subscriptionId - Subscription ID (optional, removes all if not specified)
   */
  LocalNotifyingService.prototype.unsubscribe = async function(topic, subscriptionId) {
    if (!this.topics.has(topic)) {
      return 'Unsubscribed successfully';
    }

    const topicCallbacks = this.topics.get(topic);

    if (subscriptionId) {
      // Remove specific subscription
      const index = topicCallbacks.findIndex(s => s.subscriptionId === subscriptionId);
      if (index !== -1) {
        const subscriber = topicCallbacks[index];
        topicCallbacks.splice(index, 1);
        this.subscribers.delete(subscriptionId);
      }
    } else {
      // Remove all subscriptions for this topic
      topicCallbacks.forEach(subscriber => {
        this.subscribers.delete(subscriber.subscriptionId);
      });
      topicCallbacks.length = 0;
    }

    return 'Unsubscribed successfully';
  };

  /**
   * Publish a notification to a topic in the local service
   * Synchronously calls all subscribers
   * @param {string} topic - Topic name
   * @param {any} message - Message to publish
   */
  LocalNotifyingService.prototype.notify = async function(topic, message) {
    if (!this.topics.has(topic)) {
      return 'OK';
    }

    const topicCallbacks = this.topics.get(topic);

    // Call all subscribers synchronously
    topicCallbacks.forEach(subscriber => {
      try {
        subscriber.callback(message);
      } catch (error) {
        console.error(`Error in subscriber callback for topic ${topic}:`, error);
      }
    });

    return 'OK';
  };

  /**
   * Get all topics in the local service
   */
  LocalNotifyingService.prototype.getTopics = async function() {
    return Array.from(this.topics.keys());
  };

  /**
   * Get all subscriptions
   */
  LocalNotifyingService.prototype.getSubscriptions = function() {
    const result = {};
    for (const [topic, callbacks] of this.topics) {
      result[topic] = callbacks.map(s => s.subscriptionId);
    }
    return result;
  };

  /**
   * Get service status
   */
  LocalNotifyingService.prototype.getStatus = async function() {
    return 'local notifying service running';
  };

  /**
   * Disconnect and clear all subscriptions
   */
  LocalNotifyingService.prototype.disconnect = function() {
    this.topics.clear();
    this.subscribers.clear();
    this.subscriptionCounter = 0;
  };

  // Global singleton instance for local service
  let globalLocalService = null;

  /**
   * Get the global local service instance
   * @private
   */
  function getLocalService() {
    if (!globalLocalService) {
      globalLocalService = new LocalNotifyingService();
    }
    return globalLocalService;
  }

  /**
   * NooblyJS Notifying Service Client
   * Intelligently switches between local and remote implementations
   *
   * @constructor
   * @param {Object} config - Configuration object
   * @param {string} config.instanceName - Name of the remote notifying service instance
   *                                       If not provided, uses local client-side pub/sub
   * @param {string} config.baseUrl - Base URL for API calls (default: window.location.origin)
   * @param {Object} config.headers - Additional headers to include in requests
   * @param {boolean} config.useLocal - Force use of local service even if instanceName is provided
   */
  function nooblyjsNotifying(config) {
    config = config || {};

    // Determine if we should use local or remote service
    const useLocalService = config.useLocal === true || !config.instanceName;

    if (useLocalService) {
      // Use local client-side pub/sub service
      this.isLocal = true;
      this.service = getLocalService();
    } else {
      // Use remote server-side service
      this.isLocal = false;
      this.config = Object.assign({
        instanceName: config.instanceName,
        baseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001',
        headers: {}
      }, config);

      this.subscribers = new Map();
      this.pollingIntervals = new Map();
      this.pollingEnabled = true;
      this.pollingInterval = 5000;
      this.apiBaseUrl = this._buildApiBaseUrl();
    }
  }

  /**
   * Build the base API URL based on instance name (remote only)
   * @private
   * @returns {string} The base API URL
   */
  nooblyjsNotifying.prototype._buildApiBaseUrl = function() {
    if (this.isLocal) return null;

    const instancePath = this.config.instanceName === 'default'
      ? '/services/notifying/api'
      : `/services/notifying/api/${this.config.instanceName}`;
    return `${this.config.baseUrl}${instancePath}`;
  };

  /**
   * Make an HTTP request to the API (remote only)
   * @private
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path - API endpoint path
   * @param {Object} body - Request body (optional)
   * @returns {Promise<any>} The response data
   * @throws {Error} If the request fails
   */
  nooblyjsNotifying.prototype._request = async function(method, path, body) {
    if (this.isLocal) return null;

    const url = `${this.apiBaseUrl}${path}`;
    const options = {
      method,
      headers: Object.assign({
        'Content-Type': 'application/json'
      }, this.config.headers)
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        return await response.text();
      }
    } catch (error) {
      console.error(`Request failed for ${method} ${url}:`, error);
      throw error;
    }
  };

  /**
   * Create a new notification topic
   * @param {string} topic - The name of the topic to create
   * @returns {Promise<string>} Response message (typically "OK")
   * @throws {Error} If topic creation fails
   */
  nooblyjsNotifying.prototype.createTopic = async function(topic) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('Topic name is required and must be a string');
    }

    if (this.isLocal) {
      return this.service.createTopic(topic);
    } else {
      return this._request('POST', '/topic', { topic });
    }
  };

  /**
   * Subscribe to a topic to receive notifications
   * Internally manages callbacks with local service or polling for remote
   *
   * @param {string} topic - The topic name to subscribe to
   * @param {Function} callback - Function to call when a notification is received
   * @param {Object} options - Additional subscription options
   * @param {string} options.callbackUrl - Custom callback URL (optional, server-side only)
   * @param {number} options.pollingInterval - Custom polling interval in ms (optional, server-side only)
   * @returns {Promise<Object>} Subscription details including subscription ID
   * @throws {Error} If subscription fails
   */
  nooblyjsNotifying.prototype.subscribe = async function(topic, callback, options) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('Topic name is required and must be a string');
    }
    if (!callback || typeof callback !== 'function') {
      throw new Error('Callback function is required');
    }

    if (this.isLocal) {
      return this.service.subscribe(topic, callback);
    } else {
      // Remote implementation
      const opts = Object.assign({
        pollingInterval: this.pollingInterval
      }, options || {});

      const subscriptionId = `${topic}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (!this.subscribers.has(topic)) {
        this.subscribers.set(topic, new Map());
      }

      const topicSubscribers = this.subscribers.get(topic);
      topicSubscribers.set(subscriptionId, {
        callback,
        lastNotificationTime: null
      });

      if (opts.callbackUrl) {
        try {
          await this._request('POST', `/subscribe/topic/${topic}`, {
            callbackUrl: opts.callbackUrl
          });
        } catch (error) {
          topicSubscribers.delete(subscriptionId);
          throw error;
        }
      }

      if (!this.pollingIntervals.has(topic)) {
        this._startPollingForTopic(topic, opts.pollingInterval);
      }

      return {
        subscriptionId,
        topic,
        status: 'subscribed'
      };
    }
  };

  /**
   * Start polling for new notifications on a topic (remote only)
   * @private
   * @param {string} topic - The topic to poll
   * @param {number} pollingInterval - Polling interval in milliseconds
   */
  nooblyjsNotifying.prototype._startPollingForTopic = function(topic, pollingInterval) {
    if (this.isLocal || !this.pollingEnabled) return;

    const poll = async () => {
      if (!this.subscribers.has(topic)) {
        clearInterval(intervalId);
        this.pollingIntervals.delete(topic);
        return;
      }

      try {
        const topicSubscribers = this.subscribers.get(topic);
        for (const [subscriptionId, subscriber] of topicSubscribers) {
          // Polling logic for remote service
        }
      } catch (error) {
        console.error(`Error polling topic ${topic}:`, error);
      }
    };

    const intervalId = setInterval(poll, pollingInterval);
    this.pollingIntervals.set(topic, intervalId);
  };

  /**
   * Unsubscribe from a topic
   * @param {string} topic - The topic name to unsubscribe from
   * @param {string} subscriptionId - The subscription ID to remove (optional)
   * @param {Object} options - Additional options
   * @param {string} options.callbackUrl - Callback URL to unregister from server
   * @returns {Promise<string>} Response message
   * @throws {Error} If unsubscription fails
   */
  nooblyjsNotifying.prototype.unsubscribe = async function(topic, subscriptionId, options) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('Topic name is required and must be a string');
    }

    if (this.isLocal) {
      return this.service.unsubscribe(topic, subscriptionId);
    } else {
      // Remote implementation
      const opts = options || {};

      if (opts.callbackUrl) {
        await this._request('POST', `/unsubscribe/topic/${topic}`, {
          callbackUrl: opts.callbackUrl
        });
      }

      if (this.subscribers.has(topic)) {
        const topicSubscribers = this.subscribers.get(topic);

        if (subscriptionId) {
          topicSubscribers.delete(subscriptionId);
        } else {
          topicSubscribers.clear();
        }

        if (topicSubscribers.size === 0) {
          const intervalId = this.pollingIntervals.get(topic);
          if (intervalId) {
            clearInterval(intervalId);
            this.pollingIntervals.delete(topic);
          }
          this.subscribers.delete(topic);
        }
      }

      return 'Unsubscribed successfully';
    }
  };

  /**
   * Publish a notification to a topic
   * @param {string} topic - The topic to publish to
   * @param {any} message - The message/payload to publish
   * @returns {Promise<string>} Response message (typically "OK")
   * @throws {Error} If publishing fails
   */
  nooblyjsNotifying.prototype.notify = async function(topic, message) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('Topic name is required and must be a string');
    }
    if (message === undefined || message === null) {
      throw new Error('Message is required');
    }

    if (this.isLocal) {
      return this.service.notify(topic, message);
    } else {
      return this._request('POST', `/notify/topic/${topic}`, { message });
    }
  };

  /**
   * Get the service status
   * @returns {Promise<string>} Service status message
   * @throws {Error} If status check fails
   */
  nooblyjsNotifying.prototype.getStatus = async function() {
    if (this.isLocal) {
      return this.service.getStatus();
    } else {
      return this._request('GET', '/status');
    }
  };

  /**
   * Get a list of available instances (remote only)
   * @returns {Promise<Object>} Object with instances array
   * @throws {Error} If request fails
   */
  nooblyjsNotifying.prototype.getInstances = async function() {
    if (this.isLocal) {
      throw new Error('Local service does not have multiple instances');
    }
    return this._request('GET', '/instances');
  };

  /**
   * Get the OpenAPI/Swagger specification for the API (remote only)
   * @returns {Promise<Object>} OpenAPI specification
   * @throws {Error} If request fails
   */
  nooblyjsNotifying.prototype.getSwaggerSpec = async function() {
    if (this.isLocal) {
      throw new Error('Local service does not have Swagger documentation');
    }
    return this._request('GET', '/swagger/docs.json');
  };

  /**
   * Enable or disable polling for subscriptions (remote only)
   * @param {boolean} enabled - Whether polling should be enabled
   */
  nooblyjsNotifying.prototype.setPollingEnabled = function(enabled) {
    if (this.isLocal) return;
    this.pollingEnabled = !!enabled;

    if (!this.pollingEnabled) {
      for (const [topic, intervalId] of this.pollingIntervals) {
        clearInterval(intervalId);
      }
      this.pollingIntervals.clear();
    }
  };

  /**
   * Set the polling interval for all subscriptions (remote only)
   * @param {number} interval - Polling interval in milliseconds
   * @throws {Error} If interval is not a positive number
   */
  nooblyjsNotifying.prototype.setPollingInterval = function(interval) {
    if (this.isLocal) return;
    if (typeof interval !== 'number' || interval <= 0) {
      throw new Error('Polling interval must be a positive number');
    }
    this.pollingInterval = interval;
  };

  /**
   * Get all active subscriptions
   * @returns {Object} Map of topics and their subscribers
   */
  nooblyjsNotifying.prototype.getSubscriptions = function() {
    if (this.isLocal) {
      return this.service.getSubscriptions();
    } else {
      const result = {};
      for (const [topic, subscribers] of this.subscribers) {
        result[topic] = Array.from(subscribers.keys());
      }
      return result;
    }
  };

  /**
   * Get all topics
   * @returns {Promise<Array>} Array of topic names
   */
  nooblyjsNotifying.prototype.getTopics = async function() {
    if (this.isLocal) {
      return this.service.getTopics();
    } else {
      // Remote: This would need an API endpoint
      throw new Error('getTopics not available for remote service');
    }
  };

  /**
   * Clear all subscriptions and stop polling
   */
  nooblyjsNotifying.prototype.disconnect = function() {
    if (this.isLocal) {
      this.service.disconnect();
    } else {
      for (const [topic, intervalId] of this.pollingIntervals) {
        clearInterval(intervalId);
      }
      this.pollingIntervals.clear();
      this.subscribers.clear();
    }
  };

  /**
   * Emit a notification to all local subscribers of a topic (local only)
   * @private
   * @param {string} topic - The topic
   * @param {any} message - The message to emit
   */
  nooblyjsNotifying.prototype._emitNotification = function(topic, message) {
    if (!this.isLocal) return;
    this.service.notify(topic, message);
  };

  /**
   * Manually trigger a notification to all subscribers (for testing)
   * @param {string} topic - The topic
   * @param {any} message - The message to emit
   */
  nooblyjsNotifying.prototype.emitToSubscribers = function(topic, message) {
    if (this.isLocal) {
      this.service.notify(topic, message);
    } else {
      console.warn('emitToSubscribers is for local service testing only');
    }
  };

  /**
   * Check if this is a local service instance
   * @returns {boolean} True if local, false if remote
   */
  nooblyjsNotifying.prototype.isLocalService = function() {
    return this.isLocal;
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = nooblyjsNotifying;
  } else {
    global.nooblyjsNotifying = nooblyjsNotifying;
  }

})(typeof window !== 'undefined' ? window : global);
