/**
 * @fileoverview nooblyjs-core Logging JavaScript LocalLogger
 * Client-side local logging implementation using browser console methods.
 * Provides methods for logging directly to the browser console without server communication.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

/**
 * LocalLogger - Client-side logging using browser console
 *
 * Logs messages directly to the browser console without any server communication.
 * Useful for development, debugging, and when server logging is not available.
 * Maintains the same API as the remote logger for seamless switching.
 *
 * @example
 * // Create a local logger (no server needed)
 * let logger = new LocalLogger();
 *
 * // Log at different levels
 * logger.info('User logged in', {userId: 123});
 * logger.warn('Unusual activity detected');
 * logger.error('Something went wrong', {error: 'timeout'});
 * logger.debug('Debug information', {requestId: 'abc123'});
 */
class LocalLogger {
  /**
   * Initializes a new LocalLogger instance.
   *
   * @param {Object} [options={}] - Configuration options
   * @param {boolean} [options.debug=false] - Enable debug mode
   * @param {string} [options.minLogLevel='info'] - Minimum log level to display ('debug', 'info', 'warn', 'error')
   * @param {string} [options.prefix='[Logger]'] - Prefix for console output
   * @param {boolean} [options.useGroups=false] - Use console.group() for grouping logs
   */
  constructor(options = {}) {
    /**
     * @type {Object}
     * @private
     */
    this.options = {
      debug: options.debug || false,
      minLogLevel: options.minLogLevel || 'info',
      prefix: options.prefix || '[Logger]',
      useGroups: options.useGroups || false,
      ...options
    };

    /**
     * Log levels in order of severity
     * @type {Array<string>}
     * @private
     */
    this.logLevels = ['debug', 'info', 'warn', 'error'];

    /**
     * Local log history for reference
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

    if (this.options.debug) {
      console.log(`${this.options.prefix} LocalLogger initialized with level: ${this.options.minLogLevel}`);
    }
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
   * Store a log message locally for history
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
   * Format log output for console
   *
   * @private
   * @param {string} level - The log level
   * @param {string} message - The log message
   * @param {*} meta - Optional metadata
   * @returns {string} Formatted log message
   */
  formatLogMessage(level, message, meta) {
    const timestamp = new Date().toLocaleTimeString();
    const levelUpper = level.toUpperCase().padEnd(5);
    let output = `${this.options.prefix} [${timestamp}] ${levelUpper} ${message}`;

    if (meta !== undefined && meta !== null) {
      output += ` | ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
    }

    return output;
  }

  /**
   * Logs an info message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves immediately (for API compatibility)
   *
   * @example
   * logger.info('User action', {userId: 123, action: 'login'})
   */
  async info(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    if (!this.shouldLog('info')) {
      return Promise.resolve();
    }

    this.storeLocalLog('info', message, meta);

    const formattedMessage = this.formatLogMessage('info', message, meta);
    console.info(formattedMessage);

    return Promise.resolve();
  }

  /**
   * Logs a warning message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves immediately (for API compatibility)
   *
   * @example
   * logger.warn('Unusual activity', {activity: 'multiple_failed_logins'})
   */
  async warn(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    if (!this.shouldLog('warn')) {
      return Promise.resolve();
    }

    this.storeLocalLog('warn', message, meta);

    const formattedMessage = this.formatLogMessage('warn', message, meta);
    console.warn(formattedMessage);

    return Promise.resolve();
  }

  /**
   * Logs an error message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves immediately (for API compatibility)
   *
   * @example
   * logger.error('Connection failed', {error: 'timeout', url: 'https://api.example.com'})
   */
  async error(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    if (!this.shouldLog('error')) {
      return Promise.resolve();
    }

    this.storeLocalLog('error', message, meta);

    const formattedMessage = this.formatLogMessage('error', message, meta);
    console.error(formattedMessage);

    return Promise.resolve();
  }

  /**
   * Logs a debug message
   *
   * @param {string} message - The message to log
   * @param {*} [meta] - Optional metadata to include in the log
   * @returns {Promise<void>} Promise that resolves immediately (for API compatibility)
   *
   * @example
   * logger.debug('Processing request', {requestId: 'abc123', params: {foo: 'bar'}})
   */
  async debug(message, meta) {
    if (!message) {
      throw new Error('Message is required');
    }

    if (!this.shouldLog('debug')) {
      return Promise.resolve();
    }

    this.storeLocalLog('debug', message, meta);

    const formattedMessage = this.formatLogMessage('debug', message, meta);
    console.debug(formattedMessage);

    return Promise.resolve();
  }

  /**
   * Gets local log history
   * For API compatibility - returns local logs stored in memory
   *
   * @param {number} [limit=10] - Maximum number of logs to return
   * @returns {Promise<Array<Object>>} Promise that resolves to array of log entries
   *
   * @example
   * logger.getLocalLogs(5)
   *   .then(logs => console.log('Recent logs:', logs))
   */
  async getLocalLogs(limit = 10) {
    return Promise.resolve(this.localLogs.slice(-limit));
  }

  /**
   * Gets analytics data for local logger
   * Returns summary statistics about logged messages
   *
   * @returns {Promise<Object>} Promise that resolves to analytics object
   *
   * @example
   * logger.getAnalytics()
   *   .then(analytics => console.log('Analytics:', analytics))
   */
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

  /**
   * Gets the settings for this local logger
   *
   * @returns {Promise<Object>} Promise that resolves to settings object
   */
  async getSettings() {
    return Promise.resolve({
      minLogLevel: this.options.minLogLevel,
      prefix: this.options.prefix,
      useGroups: this.options.useGroups,
      source: 'local'
    });
  }

  /**
   * Saves settings for this local logger
   *
   * @param {Object} settings - Settings object to save
   * @returns {Promise<void>} Promise that resolves when settings are saved
   */
  async saveSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      throw new Error('Settings must be a non-null object');
    }

    if (settings.minLogLevel) {
      this.setLogLevel(settings.minLogLevel);
    }
    if (settings.prefix !== undefined) {
      this.options.prefix = settings.prefix;
    }
    if (settings.useGroups !== undefined) {
      this.options.useGroups = settings.useGroups;
    }

    return Promise.resolve();
  }

  /**
   * Clears the local log history
   *
   * @returns {void}
   */
  clearLocalLogs() {
    this.localLogs = [];
    console.log(`${this.options.prefix} Local logs cleared`);
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
    console.log(`${this.options.prefix} Log level set to: ${level}`);
  }

  /**
   * Gets the number of logs currently stored
   *
   * @returns {number} Number of stored logs
   */
  getLogCount() {
    return this.localLogs.length;
  }

  /**
   * Prints all stored logs to the console in a grouped format
   *
   * @returns {void}
   */
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

// Export for use in browser or Node.js environments
if (typeof window !== 'undefined') {
  // Browser environment - attach to window object
  window.LocalLogger = LocalLogger;
}

if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS environment
  module.exports = LocalLogger;
}
