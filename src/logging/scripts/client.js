/**
 * @fileoverview nooblyjs-core Logging JavaScript Client Library
 * Client-side library for logging from web applications.
 * Provides methods for logging at different levels: info, warn, error, and debug.
 *
 * Supports two modes:
 * 1. Local Mode (no instance name): Uses browser console for logging
 * 2. Remote Mode (with instance name): Sends logs to the logging service API
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

/**
 * LocalLogger - Client-side logging using browser console
 * (Included inline for convenience - also available in index.js)
 *
 * @private
 */
class LocalLogger {
  constructor(options = {}) {
    this.options = {
      debug: options.debug || false,
      minLogLevel: options.minLogLevel || 'info',
      prefix: options.prefix || '[Logger]',
      useGroups: options.useGroups || false,
      ...options
    };

    this.logLevels = ['debug', 'info', 'warn', 'error'];
    this.localLogs = [];
    this.maxLocalLogs = 100;

    if (this.options.debug) {
      console.log(`${this.options.prefix} LocalLogger initialized with level: ${this.options.minLogLevel}`);
    }
  }

  shouldLog(level) {
    const messagePriority = this.logLevels.indexOf(level);
    const minPriority = this.logLevels.indexOf(this.options.minLogLevel);
    return messagePriority >= minPriority;
  }

  storeLocalLog(level, message, meta) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      message: message,
      meta: meta
    };

    this.localLogs.push(logEntry);

    if (this.localLogs.length > this.maxLocalLogs) {
      this.localLogs.shift();
    }
  }

  formatLogMessage(level, message, meta) {
    const timestamp = new Date().toLocaleTimeString();
    const levelUpper = level.toUpperCase().padEnd(5);
    let output = `${this.options.prefix} [${timestamp}] ${levelUpper} ${message}`;

    if (meta !== undefined && meta !== null) {
      output += ` | ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
    }

    return output;
  }

  async info(message, meta) {
    if (!message) throw new Error('Message is required');
    if (!this.shouldLog('info')) return Promise.resolve();
    this.storeLocalLog('info', message, meta);
    const formattedMessage = this.formatLogMessage('info', message, meta);
    console.info(formattedMessage);
    return Promise.resolve();
  }

  async warn(message, meta) {
    if (!message) throw new Error('Message is required');
    if (!this.shouldLog('warn')) return Promise.resolve();
    this.storeLocalLog('warn', message, meta);
    const formattedMessage = this.formatLogMessage('warn', message, meta);
    console.warn(formattedMessage);
    return Promise.resolve();
  }

  async error(message, meta) {
    if (!message) throw new Error('Message is required');
    if (!this.shouldLog('error')) return Promise.resolve();
    this.storeLocalLog('error', message, meta);
    const formattedMessage = this.formatLogMessage('error', message, meta);
    console.error(formattedMessage);
    return Promise.resolve();
  }

  async debug(message, meta) {
    if (!message) throw new Error('Message is required');
    if (!this.shouldLog('debug')) return Promise.resolve();
    this.storeLocalLog('debug', message, meta);
    const formattedMessage = this.formatLogMessage('debug', message, meta);
    console.debug(formattedMessage);
    return Promise.resolve();
  }

  async getLocalLogs(limit = 10) {
    return Promise.resolve(this.localLogs.slice(-limit));
  }

  async getAnalytics() {
    const stats = {
      totalLogs: this.localLogs.length,
      debug: this.localLogs.filter(l => l.level === 'debug').length,
      info: this.localLogs.filter(l => l.level === 'info').length,
      warn: this.localLogs.filter(l => l.level === 'warn').length,
      error: this.localLogs.filter(l => l.level === 'error').length,
      source: 'local'
    };
    return Promise.resolve(stats);
  }

  async getSettings() {
    return Promise.resolve({
      minLogLevel: this.options.minLogLevel,
      prefix: this.options.prefix,
      useGroups: this.options.useGroups,
      source: 'local'
    });
  }

  async saveSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Settings must be a non-null object');
    }
    if (settings.minLogLevel) this.setLogLevel(settings.minLogLevel);
    if (settings.prefix !== undefined) this.options.prefix = settings.prefix;
    if (settings.useGroups !== undefined) this.options.useGroups = settings.useGroups;
    return Promise.resolve();
  }

  clearLocalLogs() {
    this.localLogs = [];
    console.log(`${this.options.prefix} Local logs cleared`);
  }

  getLogLevel() {
    return this.options.minLogLevel;
  }

  setLogLevel(level) {
    if (!this.logLevels.includes(level)) {
      throw new Error(`Invalid log level: ${level}. Must be one of: ${this.logLevels.join(', ')}`);
    }
    this.options.minLogLevel = level;
    console.log(`${this.options.prefix} Log level set to: ${level}`);
  }

  getLogCount() {
    return this.localLogs.length;
  }

  printLogs() {
    if (this.localLogs.length === 0) {
      console.log(`${this.options.prefix} No logs stored`);
      return;
    }

    if (this.options.useGroups) {
      console.group(`${this.options.prefix} Log History (${this.localLogs.length})`);
    } else {
      console.log(`${this.options.prefix} Log History (${this.localLogs.length}):`);
    }

    this.localLogs.forEach((log, index) => {
      const message = `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`;
      if (log.meta) {
        console.log(`  ${index + 1}. ${message}`, log.meta);
      } else {
        console.log(`  ${index + 1}. ${message}`);
      }
    });

    if (this.options.useGroups) {
      console.groupEnd();
    }
  }
}

/**
 * nooblyjs-core Logging Service Client
 *
 * Provides a JavaScript client for consuming the logging service API from browser applications.
 * Supports two modes:
 * 1. LOCAL MODE: When no instanceName is passed, uses browser console for logging
 * 2. REMOTE MODE: When instanceName is provided, sends logs to the logging service API
 *
 * @example
 * // Local mode - logs to browser console only
 * let localLogger = new nooblyjslogging();
 * localLogger.info('App started');
 *
 * // Remote mode - logs to server
 * let remoteLogger = new nooblyjslogging('default');
 * remoteLogger.info('User logged in', {userId: 123, timestamp: new Date()});
 *
 * // Log at different levels
 * logger.warn('Unusual activity detected', {activity: 'multiple_login_attempts'});
 * logger.error('Database connection failed', {error: 'timeout', duration: 5000});
 * logger.debug('Processing request', {requestId: 'abc123', params: {foo: 'bar'}});
 *
 * // Get analytics
 * logger.getAnalytics()
 *   .then(analytics => console.log('Log stats:', analytics))
 *   .catch(err => console.error(err));
 */
class nooblyjslogging {
  /**
   * Initializes a new Logging Service client instance.
   *
   * When no instanceName is provided, uses LOCAL mode (browser console logging).
   * When instanceName is provided, uses REMOTE mode (server-side logging API).
   *
   * @param {string} [instanceName] - The name of the logger instance to connect to.
   *                                  If undefined or null, uses local console logging.
   *                                  Must match an instance on the server for remote mode.
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.apiKey] - Optional API key for authentication (remote mode only)
   * @param {boolean} [options.debug=false] - Enable debug logging
   * @param {string} [options.minLogLevel='info'] - Minimum log level to send ('debug', 'info', 'warn', 'error')
   * @param {string} [options.prefix='[Logger]'] - Prefix for console output (local mode only)
   * @throws {TypeError} If instanceName is provided but is not a string
   */
  constructor(instanceName, options = {}) {
    if (instanceName && typeof instanceName !== 'string') {
      throw new TypeError('instanceName must be a string');
    }

    /**
     * Determine if using local or remote mode
     * Local mode: no instanceName provided (undefined or null)
     * Remote mode: instanceName provided (including 'default')
     * @type {boolean}
     * @private
     */
    this.isLocal = !instanceName;

    /**
     * @type {string|null}
     * @private
     */
    this.instanceName = instanceName || null;

    /**
     * @type {Object}
     * @private
     */
    this.options = {
      apiKey: options.apiKey || null,
      debug: options.debug || false,
      minLogLevel: options.minLogLevel || 'info',
      prefix: options.prefix || '[Logger]',
      useGroups: options.useGroups || false,
      ...options
    };

    /**
     * Local logger instance (used in local mode)
     * @type {LocalLogger|null}
     * @private
     */
    this.localLogger = null;

    /**
     * @type {string}
     * @private
     */
    this.baseUrl = this.getBaseUrl();

    /**
     * Log levels in order of severity
     * @type {Array<string>}
     * @private
     */
    this.logLevels = ['debug', 'info', 'warn', 'error'];

    /**
     * Local log history for offline support
     * @type {Array<Object>}
     * @private
     */
    this.localLogs = [];

    /**
     * Max number of local logs to keep in memory
     * @type {number}
     * @private
     */
    this.maxLocalLogs = 100;

    // Initialize local logger if in local mode
    if (this.isLocal) {
      this.localLogger = new LocalLogger({
        debug: this.options.debug,
        minLogLevel: this.options.minLogLevel,
        prefix: this.options.prefix,
        useGroups: this.options.useGroups
      });

      if (this.options.debug) {
        console.log('[nooblyjslogging] Initialized in LOCAL mode');
        console.log('[nooblyjslogging] Min log level:', this.options.minLogLevel);
      }
    } else {
      if (this.options.debug) {
        console.log('[nooblyjslogging] Initialized in REMOTE mode with instance:', this.instanceName);
        console.log('[nooblyjslogging] Base URL:', this.baseUrl);
        console.log('[nooblyjslogging] Min log level:', this.options.minLogLevel);
      }
    }
  }

  /**
   * Get the base URL for the logging API
   * Handles both default and named instances
   *
   * @private
   * @returns {string} The base URL for API calls
   */
  getBaseUrl() {
    if (this.instanceName === 'default' || !this.instanceName) {
      return '/services/logging/api';
    }
    return `/services/logging/api/${this.instanceName}`;
  }

  /**
   * Determines if a message should be logged based on its level
   *
   * @private
   * @param {string} level - The log level
   * @returns {boolean} True if the message should be logged
   */
  shouldLog(level) {
    const messagePriority = this.logLevels.indexOf(level);
    const minPriority = this.logLevels.indexOf(this.options.minLogLevel);
    return messagePriority >= minPriority;
  }

  /**
   * Make a fetch request to the logging API
   *
   * @private
   * @param {string} endpoint - The API endpoint
   * @param {*} logData - The log data to send
   * @returns {Promise<*>} The response data
   * @throws {Error} If the API request fails
   */
  async request(endpoint, logData) {
    const url = `${this.baseUrl}${endpoint}`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (this.options.apiKey) {
      options.headers['X-API-Key'] = this.options.apiKey;
    }

    options.body = JSON.stringify(logData);

    if (this.options.debug) {
      console.log('[nooblyjslogging] Request:', url, logData);
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
      if (this.options.debug) {
        console.error('[nooblyjslogging] Request failed:', error);
      }
      // Still store locally even if API fails
      this.storeLocalLog('error', 'Failed to send log to server', { error: error.message });
      throw error;
    }
  }

  /**
   * Store a log message locally for offline support
   *
   * @private
   * @param {string} level - The log level
   * @param {string} message - The log message
   * @param {*} meta - Optional metadata
   */
  storeLocalLog(level, message, meta) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level,
      message: message,
      meta: meta
    };

    this.localLogs.push(logEntry);

    // Keep only the last maxLocalLogs entries
    if (this.localLogs.length > this.maxLocalLogs) {
      this.localLogs.shift();
    }
  }

  /**
   * Logs an info message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves when the message is logged
   * @throws {Error} If the message is missing or the API request fails
   *
   * @example
   * // Local mode
   * let logger = new nooblyjslogging();
   * logger.info('User action', {userId: 123})
   *
   * // Remote mode
   * let logger = new nooblyjslogging('default');
   * logger.info('User action', {userId: 123, action: 'login'})
   *   .then(() => console.log('Logged'))
   *   .catch(err => console.error(err));
   */
  async info(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    // Delegate to local logger if in local mode
    if (this.isLocal) {
      return await this.localLogger.info(message, meta);
    }

    if (!this.shouldLog('info')) {
      return;
    }

    const endpoint = '/info';
    const logData = { message, meta };

    this.storeLocalLog('info', message, meta);

    try {
      return await this.request(endpoint, logData);
    } catch (error) {
      // Log locally on failure, but don't throw - allow app to continue
      if (this.options.debug) {
        console.error('[nooblyjslogging] Info log failed:', error.message);
      }
    }
  }

  /**
   * Logs a warning message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves when the message is logged
   * @throws {Error} If the message is missing or the API request fails
   *
   * @example
   * // Local mode
   * let logger = new nooblyjslogging();
   * logger.warn('Unusual activity', {activity: 'multiple_failed_logins'})
   *
   * // Remote mode
   * let logger = new nooblyjslogging('default');
   * logger.warn('Unusual activity', {activity: 'multiple_failed_logins'})
   */
  async warn(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    // Delegate to local logger if in local mode
    if (this.isLocal) {
      return await this.localLogger.warn(message, meta);
    }

    if (!this.shouldLog('warn')) {
      return;
    }

    const endpoint = '/warn';
    const logData = { message, meta };

    this.storeLocalLog('warn', message, meta);

    try {
      return await this.request(endpoint, logData);
    } catch (error) {
      if (this.options.debug) {
        console.error('[nooblyjslogging] Warn log failed:', error.message);
      }
    }
  }

  /**
   * Logs an error message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves when the message is logged
   * @throws {Error} If the message is missing or the API request fails
   *
   * @example
   * // Local mode
   * let logger = new nooblyjslogging();
   * logger.error('Connection failed', {error: 'timeout'})
   *
   * // Remote mode
   * let logger = new nooblyjslogging('default');
   * logger.error('Connection failed', {error: 'timeout', url: 'https://api.example.com'})
   */
  async error(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    // Delegate to local logger if in local mode
    if (this.isLocal) {
      return await this.localLogger.error(message, meta);
    }

    if (!this.shouldLog('error')) {
      return;
    }

    const endpoint = '/error';
    const logData = { message, meta };

    this.storeLocalLog('error', message, meta);

    try {
      return await this.request(endpoint, logData);
    } catch (error) {
      if (this.options.debug) {
        console.error('[nooblyjslogging] Error log failed:', error.message);
      }
    }
  }

  /**
   * Logs a debug message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves when the message is logged
   * @throws {Error} If the message is missing or the API request fails
   *
   * @example
   * // Local mode
   * let logger = new nooblyjslogging();
   * logger.debug('Processing request', {requestId: 'abc123'})
   *
   * // Remote mode
   * let logger = new nooblyjslogging('default');
   * logger.debug('Processing request', {requestId: 'abc123', params: {foo: 'bar'}})
   */
  async debug(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    // Delegate to local logger if in local mode
    if (this.isLocal) {
      return await this.localLogger.debug(message, meta);
    }

    if (!this.shouldLog('debug')) {
      return;
    }

    const endpoint = '/log';
    const logData = { message, meta };

    this.storeLocalLog('debug', message, meta);

    try {
      return await this.request(endpoint, logData);
    } catch (error) {
      if (this.options.debug) {
        console.error('[nooblyjslogging] Debug log failed:', error.message);
      }
    }
  }

  /**
   * Gets analytics data for this logger instance
   *
   * For local mode, returns statistics about logs stored in memory.
   * For remote mode, fetches analytics from the server.
   *
   * @returns {Promise<Object>} Promise that resolves to analytics data
   * @throws {Error} If the API request fails (remote mode only)
   *
   * @example
   * logger.getAnalytics()
   *   .then(analytics => console.log('Analytics:', analytics))
   *   .catch(err => console.error(err));
   */
  async getAnalytics() {
    // Delegate to local logger if in local mode
    if (this.isLocal) {
      return await this.localLogger.getAnalytics();
    }

    const url = `${this.baseUrl}/analytics`;
    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (this.options.apiKey) {
      options.headers['X-API-Key'] = this.options.apiKey;
    }

    if (this.options.debug) {
      console.log('[nooblyjslogging] Getting analytics');
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (this.options.debug) {
        console.error('[nooblyjslogging] Failed to get analytics:', error);
      }
      throw error;
    }
  }

  /**
   * Gets the settings for this logger instance
   *
   * @returns {Promise<Object>} Promise that resolves to settings object
   * @throws {Error} If the API request fails
   *
   * @example
   * logger.getSettings()
   *   .then(settings => console.log('Settings:', settings))
   *   .catch(err => console.error(err));
   */
  async getSettings() {
    const url = `${this.baseUrl}/settings`;
    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (this.options.apiKey) {
      options.headers['X-API-Key'] = this.options.apiKey;
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (this.options.debug) {
        console.error('[nooblyjslogging] Failed to get settings:', error);
      }
      throw error;
    }
  }

  /**
   * Saves settings for this logger instance
   *
   * @param {Object} settings - Settings object to save
   * @returns {Promise<void>} Promise that resolves when settings are saved
   * @throws {Error} If the settings are invalid or the API request fails
   *
   * @example
   * logger.saveSettings({minLogLevel: 'warn'})
   *   .then(() => console.log('Settings saved'))
   *   .catch(err => console.error(err));
   */
  async saveSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Settings must be a non-null object');
    }

    const url = `${this.baseUrl}/settings`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (this.options.apiKey) {
      options.headers['X-API-Key'] = this.options.apiKey;
    }

    options.body = JSON.stringify(settings);

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      return await response.text();
    } catch (error) {
      if (this.options.debug) {
        console.error('[nooblyjslogging] Failed to save settings:', error);
      }
      throw error;
    }
  }

  /**
   * Gets the local log history
   *
   * @param {number} [limit=10] - Maximum number of logs to return
   * @returns {Array<Object>} Array of log entries
   */
  getLocalLogs(limit = 10) {
    return this.localLogs.slice(-limit);
  }

  /**
   * Clears the local log history
   *
   * @returns {void}
   */
  clearLocalLogs() {
    this.localLogs = [];
  }

  /**
   * Get the current log level
   *
   * @returns {string} The current minimum log level
   */
  getLogLevel() {
    return this.options.minLogLevel;
  }

  /**
   * Set the minimum log level
   *
   * @param {string} level - The new minimum log level ('debug', 'info', 'warn', 'error')
   * @throws {Error} If the level is not valid
   */
  setLogLevel(level) {
    if (!this.logLevels.includes(level)) {
      throw new Error(`Invalid log level: ${level}. Must be one of: ${this.logLevels.join(', ')}`);
    }
    this.options.minLogLevel = level;
  }
}

// Export for use in browser or Node.js environments
if (typeof window !== 'undefined') {
  // Browser environment - attach to window object
  window.nooblyjslogging = nooblyjslogging;
}

if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS environment
  module.exports = nooblyjslogging;
}
