/**
 * @fileoverview A console logger implementation providing formatted logging
 * with timestamps, device identification, and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const os = require('os');

const { correlationFields } = require('../../telemetry/requestContext');

/**
 * Prefixes a log line with the request id, and the trace id when telemetry
 * is active, so every line written during a request can be grouped (feature 07).
 * @param {string} line The formatted line.
 * @return {string} The line, prefixed when a request is in flight.
 */
function withRequestFields(line) {
  const fields = correlationFields();
  const keys = Object.keys(fields);
  if (keys.length === 0) return line;
  return `[${keys.map((k) => `${k}=${fields[k]}`).join(' ')}] ${line}`;
}

/**
 * A class that implements a console logger with formatted output.
 * Provides methods for logging info, warning, and error messages to the console.
 * @class
 */
class Logging {

  /**
   * Initializes the console logger.
   * @param {Object=} options Configuration options (includes instanceName for multi-instance support).
   * @param {EventEmitter=} eventEmitter Optional event emitter for log events.
   */
  constructor(options, eventEmitter) {
    this.settings = {
      description: 'The only setting that is needed is the minloglevel',
      list: [
        { setting: 'minLogLevel', type: 'list', values: ['error', 'warn', 'info', 'log'] }
      ]
    };
    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = (options && options.instanceName) || 'default';
    if (options?.log?.level) {
      this.settings.minLogLevel = options.log.level;
    }
  }

  /**
   * Get all our settings
   * @returns {Promise<Object>} The current settings object.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Set all our settings
   * @param {Object} settings The new settings to save.
   * @returns {Promise<void>}
   */
  async saveSettings(settings) {
    for (const { setting } of this.settings.list) {
      if (settings[setting] != null) {
        this.settings[setting] = settings[setting];
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
   * Formats the message and metadata into a log string.
   * @private
   * @param {string} message The message to log.
   * @param {*=} meta Optional metadata to include in the log.
   * @return {string} The formatted message.
   */
  formatMessage_(message, meta) {
    return withRequestFields(this.formatBody_(message, meta));
  }

  /**
   * Formats the message body (without request correlation).
   * @private
   * @param {string} message The message to log.
   * @param {*=} meta Optional metadata to include in the log.
   * @return {string} The formatted message.
   */
  formatBody_(message, meta) {
    if (meta === undefined || meta === null) {
      return message;
    }

    // If meta is an object, stringify it nicely
    if (typeof meta === 'object') {
      try {
        const metaStr = JSON.stringify(meta, null, 2);
        return `${message} ${metaStr}`;
      } catch (err) {
        // If JSON.stringify fails, convert to string
        return `${message} ${String(meta)}`;
      }
    }

    // For primitive types, just append
    return `${message} ${meta}`;
  }

  /**
   * Logs an info message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @param {*=} meta Optional metadata to include in the log (object, string, etc.).
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async info(message, meta) {
    if (!this.shouldLog('info')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const formattedMessage = this.formatMessage_(message, meta);
    const logMessage = `${timestamp} - INFO - ${device} - ${formattedMessage}`;
    console.log(logMessage);
    if (this.eventEmitter_) {
      const eventName = `log:info:${this.instanceName_}`;
      this.eventEmitter_.emit(eventName, { message: logMessage });
    }
  }

  /**
   * Logs a warning message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @param {*=} meta Optional metadata to include in the log (object, string, etc.).
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async warn(message, meta) {
    if (!this.shouldLog('warn')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const formattedMessage = this.formatMessage_(message, meta);
    const logMessage = `${timestamp} - WARN - ${device} - ${formattedMessage}`;
    console.warn(logMessage);
    if (this.eventEmitter_) {
      const eventName = `log:warn:${this.instanceName_}`;
      this.eventEmitter_.emit(eventName, { message: logMessage });
    }
  }

  /**
   * Logs an error message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @param {*=} meta Optional metadata to include in the log (object, string, etc.).
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async error(message, meta) {
    if (!this.shouldLog('error')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const formattedMessage = this.formatMessage_(message, meta);
    const logMessage = `${timestamp} - ERROR - ${device} - ${formattedMessage}`;
    console.error(logMessage);
    if (this.eventEmitter_) {
      const eventName = `log:error:${this.instanceName_}`;
      this.eventEmitter_.emit(eventName, { message: logMessage });
    }
  }

  /**
   * Logs a generic message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @param {*=} meta Optional metadata to include in the log (object, string, etc.).
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async debug(message, meta) {
    if (!this.shouldLog('log')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const formattedMessage = this.formatMessage_(message, meta);
    const logMessage = `${timestamp} - LOG - ${device} - ${formattedMessage}`;
    console.log(logMessage);
    if (this.eventEmitter_) {
      const eventName = `log:log:${this.instanceName_}`;
      this.eventEmitter_.emit(eventName, { message: logMessage });
    }
  }

  /**
   * Logs a generic message to the console (alias for debug method).
   * @param {string} message The message to log.
   * @param {*=} meta Optional metadata to include in the log (object, string, etc.).
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async log(message, meta) {
    return this.debug(message, meta);
  }

}

module.exports = Logging;
