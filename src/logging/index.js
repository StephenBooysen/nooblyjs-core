/**
 * @fileoverview Factory for creating logger instances.
 */

const ConsoleLogger = require('./providers/consoleLogger');
const FileLogger = require('./providers/fileLogger');

/**
 * Creates a logger instance based on the provided type.
 * @param {string} type The type of logger to create. Valid options are 'console' and 'file'.
 * @param {Object=} options The options for the logger.
 * @return {!ConsoleLogger|!FileLogger} A logger instance.
 */
function createLogger(type, options, eventEmitter) {
  if (type === 'file') {
    return new FileLogger(options, eventEmitter);
  } else {
    return new ConsoleLogger(options, eventEmitter);
  }
}

module.exports = createLogger;
