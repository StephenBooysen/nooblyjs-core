/**
 * @fileoverview A file logger implementation providing formatted logging
 * to files with timestamps, device identification, and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('fs');

/**
 * A class that implements a file logger with formatted output.
 * Provides methods for logging info, warning, and error messages to files.
 * @class
 */
class loggingFile {
  /**
   * Initializes the file logger with target filename.
   * @param {Object} options Configuration options for the file logger.
   * @param {string} options.filename The name of the file to log to.
   * @param {EventEmitter=} eventEmitter Optional event emitter for log events.
   */
  constructor(options, eventEmitter) {
    /** @private @const {string} */
    this.filename_ = options.filename;
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Logs an info message to a file with timestamp and device info.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   * @throws {Error} When file write operation fails.
   */
  async info(message) {
    const timestamp = new Date().toISOString();
    const os = require('os');
    const device = os.hostname();
    const logMessage = `${timestamp} - INFO - ${device} - ${message}`;
    fs.appendFileSync(this.filename_, logMessage + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:info', { filename: this.filename_, message: logMessage });
  }

  /**
   * Logs a warning message to a file with timestamp and device info.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   * @throws {Error} When file write operation fails.
   */
  async warn(message) {
    const timestamp = new Date().toISOString();
    const os = require('os');
    const device = os.hostname();
    const logMessage = `${timestamp} - WARN - ${device} - ${message}`;
    fs.appendFileSync(this.filename_, logMessage + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:warn', { filename: this.filename_, message: logMessage });
  }

  /**
   * Logs an error message to a file with timestamp and device info.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   * @throws {Error} When file write operation fails.
   */
  async error(message) {
    const timestamp = new Date().toISOString();
    const os = require('os');
    const device = os.hostname();
    const logMessage = `${timestamp} - ERROR - ${device} - ${message}`;
    fs.appendFileSync(this.filename_, logMessage + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:error', { filename: this.filename_, message: logMessage });
  }

  /**
   * Logs a generic message to a file.
   * @param {string} message The message to log.
   * @return {Promise<void>} A promise that resolves when the message is logged.
   * @throws {Error} When file write operation fails.
   */
  async log(message) {
    fs.appendFileSync(this.filename_, message + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:log', { filename: this.filename_, message: message });
  }
}

module.exports = loggingFile;
