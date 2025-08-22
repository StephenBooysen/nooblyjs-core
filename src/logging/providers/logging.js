/**
 * @fileoverview A console logger implementation providing formatted logging
 * with timestamps, device identification, and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const os = require('os');

/**
 * A class that implements a console logger with formatted output.
 * Provides methods for logging info, warning, and error messages to the console.
 * @class
 */
class logging {
  /**
   * Initializes the console logger.
   * @param {Object=} options Configuration options (unused in this implementation).
   * @param {EventEmitter=} eventEmitter Optional event emitter for log events.
   */
  constructor(options, eventEmitter) {
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Logs an info message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async info(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - INFO - ${device} - ${message}`;
    console.log(logMessage);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:info', { message: logMessage });
  }

  /**
   * Logs a warning message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async warn(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - WARN - ${device} - ${message}`;
    console.warn(logMessage);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:warn', { message: logMessage });
  }

  /**
   * Logs an error message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async error(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - ERROR - ${device} - ${message}`;
    console.error(logMessage);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:error', { message: logMessage });
  }

  /**
   * Logs a generic message to the console with timestamp and device info.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   */
  async log(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - ${device} - ${message}`;
    console.log(logMessage);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:log', { message: logMessage });
  }

}

module.exports = logging;
