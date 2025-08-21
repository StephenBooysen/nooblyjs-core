/**
 * @fileoverview A console logger implementation.
 */

const os = require('os');

/**
 * A class that implements a console logger.
 */
class logging {
  constructor(options, eventEmitter) {
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Logs a message to the console.
   * @param {string} message The message to log.
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
   * Logs a warning message to the console.
   * @param {string} message The message to log.
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
   * Logs a error message to the console.
   * @param {string} message The message to log.
   */
  async error(message) {
    const timestamp = new Date().toISOString();
    const device = os.hostname();
    const logMessage = `${timestamp} - ERROR - ${device} - ${message}`;
    console.error(logMessage);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:error', { message: logMessage });
  }

}

module.exports = logging;
