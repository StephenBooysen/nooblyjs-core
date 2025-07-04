/**
 * @fileoverview Factory for creating logger instances.
 */

const ConsoleLogger = require('./providers/consoleLogger');
const FileLogger = require('./providers/fileLogger');
const Routes = require('./routes');

/**
 * Creates a logger instance based on the provided type.
 * @param {string} type The type of logger to create. Valid options are 'console' and 'file'.
 * @param {Object=} options The options for the logger.
 * @return {!ConsoleLogger|!FileLogger} A logger instance.
 */
function createLogger(type, options, eventEmitter) {
  let logger;
  if (type === 'file') {
    logger = new FileLogger(options, eventEmitter);
  } else {
    logger = new ConsoleLogger(options, eventEmitter);
  }
  Routes(options, eventEmitter, logger);
  return logger;
}

module.exports = createLogger;
