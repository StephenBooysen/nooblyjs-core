/**
 * @fileoverview API-based logging service implementation that proxies requests to a remote logging service.
 * Allows client applications to consume backend logging API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements logging operations via HTTP API calls to a remote service.
 * Provides methods for logging messages at various levels through REST endpoints.
 * @class
 */
class LoggingApi {
  /**
   * Initializes the Logging API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 5000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for logging events.
   */
  constructor(options = {}, eventEmitter) {
    this.apiRoot = options.apiRoot || 'http://localhost:3000';
    this.apiKey = options.apiKey || null;
    this.timeout = options.timeout || 5000;
    this.eventEmitter_ = eventEmitter;

    // Configure axios instance
    this.client = axios.create({
      baseURL: this.apiRoot,
      timeout: this.timeout,
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });
  }

  /**
   * Logs a message via the remote logging API.
   * @param {string} level The log level (info, warn, error, debug).
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async log(level, message, meta = {}) {
    try {
      await this.client.post('/services/logging/api/log', { level, message, meta });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('logging:log', { level, message });
    } catch (error) {
      // Silently fail for logging to avoid recursive errors
      if (this.eventEmitter_)
        this.eventEmitter_.emit('logging:error', { operation: 'log', error: error.message });
    }
  }

  /**
   * Logs an info message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async info(message, meta = {}) {
    return this.log('info', message, meta);
  }

  /**
   * Logs a warning message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async warn(message, meta = {}) {
    return this.log('warn', message, meta);
  }

  /**
   * Logs an error message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async error(message, meta = {}) {
    return this.log('error', message, meta);
  }

  /**
   * Logs a debug message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async debug(message, meta = {}) {
    return this.log('debug', message, meta);
  }

  /**
   * Queries logs from the remote logging API.
   * @param {Object} query Query parameters.
   * @return {Promise<Array>} A promise that resolves to the log entries.
   */
  async query(query = {}) {
    try {
      const response = await this.client.get('/services/logging/api/logs', { params: query });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('logging:error', { operation: 'query', error: error.message });
      throw error;
    }
  }
}

module.exports = LoggingApi;
