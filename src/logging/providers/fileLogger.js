/**
 * @fileoverview A file logger implementation.
 */

const fs = require('fs');

/**
 * A class that implements a file logger.
 */
class FileLogger {
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
  async log(message) {
    fs.appendFileSync(this.filename_, message + '\n');
    if (this.eventEmitter_)
      this.eventEmitter_.emit('log:log', { filename: this.filename_, message });
  }
}

module.exports = FileLogger;
