/**
 * @fileoverview A console logger implementation.
 */

const os = require('os');

/**
 * A class that implements a console logger.
 */
class ConsoleLogger {
  constructor(options, eventEmitter) {
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Logs a message to the console.
   * @param {string} message The message to log.
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

module.exports = ConsoleLogger;
