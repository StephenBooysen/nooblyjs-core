/**
 * @fileoverview A file logger implementation.
 */

const fs = require('fs');

/**
 * A class that implements a file logger.
 */
class loggingFile {
  /**
   * Initializes the file logger.
   * @param {string} filename The name of the file to log to.
   */
  constructor(options, eventEmitter) {
    /** @private @const {string} */
    this.filename_ = options.filename;
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Logs a message to a file.
   * @param {string} message The message to log.
   */
  async info(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - INFO - ${device} - ${message}`;
    fs.appendFileSync(this.filename_, message + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:log', { filename: this.filename_, message });
  }

  /**
   * Logs a message to a file.
   * @param {string} message The message to log.
   */
  async warn(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - WARN - ${device} - ${message}`;
    fs.appendFileSync(this.filename_, message + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:warn', { filename: this.filename_, message });
  }

  /**
   * Logs a message to a file.
   * @param {string} message The message to log.
   */
  async error(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - ERROR - ${device} - ${message}`;
    fs.appendFileSync(this.filename_, message + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:error', { filename: this.filename_, message });
  }
}

module.exports = loggingFile;
