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

    this.settings = {};
    this.settings.description = "Configuration settings for the Logging API Provider"
    this.settings.list = [
      {setting: "minLogLevel", type: "list", values : ['error', 'warn', 'info', 'log']},
      {setting: "url", type: "string", values : ['e.g. http:/logging.com']},
      {setting: "apikey", type: "string", values : ['Please speak to you admin for this key']}
    ];
    this.settings.api = options.api || options.apiRoot || 'http://localhost:3000';
    this.settings.apikey = options.apiKey || null;
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
   * Get all our settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings){
    for (let i = 0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        const settingName = this.settings.list[i].setting;
        const newValue = settings[this.settings.list[i].setting];
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('logging:setting-changed', { setting: settingName, value: newValue });
        }
      }
    }
  }

  /**
   * Logs a message via the remote logging API.
   * @param {string} level The log level (info, warn, error, debug).
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async sendLog_(level, message, meta = {}) {
    try {
      await this.client.post('/services/logging/api/log', { level, message, meta });
      if (this.eventEmitter_) {
        const eventName = `log:${level}:${this.instanceName_}`;
        this.eventEmitter_.emit(eventName, { level, message });
      }
    } catch (error) {
      // Silently fail for logging to avoid recursive errors
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('logging:error', { operation: 'log', error: error.message });
      }
    }
  }

    /**
   * Determines the priority of a log level.
   * @param {} level 
   * @returns 
   */
  determineLogLevelPriority(level) {
    const levels = ['error', 'warn', 'info', 'log'];
    return levels.indexOf(level);
  }

  /**
   * Determines if a message should be logged based on its level and the minimum log level.
   * @param {*} level 
   * @returns 
   */
  shouldLog(level) {
    if (!this.settings.minLogLevel) {
      return true; 
    }
    const messagePriority = this.determineLogLevelPriority(level);
    const minPriority = this.determineLogLevelPriority(this.settings.minLogLevel);
    return messagePriority <= minPriority;
  } 

  /**
   * Logs an info message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async info(message, meta = {}) {
    if (!this.shouldLog('info')) {
      return;
    }
    return this.sendLog_('info', message, meta);
  }

  /**
   * Logs a warning message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async warn(message, meta = {}) {
    if (!this.shouldLog('warn')) {
      return;
    }
    return this.sendLog_('warn', message, meta);
  }

  /**
   * Logs an error message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async error(message, meta = {}) {
    if (!this.shouldLog('error')) {
      return;
    }
    return this.sendLog_('error', message, meta);
  }

  /**
   * Logs a debug/log level message via the remote logging API.
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async debug(message, meta = {}) {
    if (!this.shouldLog('log')) {
      return;
    }
    return this.sendLog_('log', message, meta);
  }

  /**
   * Logs a generic message via the remote logging API (alias for debug).
   * @param {string} message The log message.
   * @param {Object=} meta Additional metadata.
   * @return {Promise<void>} A promise that resolves when the log is sent.
   */
  async log(message, meta = {}) {
    return this.debug(message, meta);
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
