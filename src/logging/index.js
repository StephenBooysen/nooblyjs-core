/**
 * @fileoverview Factory for creating logger instances.
 */

const logging = require('./providers/logging');
const loggingFile = require('./providers/loggingFile');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a logger instance based on the provided type.
 * @param {string} type The type of logger to create. Valid options are 'console' and 'file'.
 * @param {Object=} options The options for the logger.
 * @return {!logging|!loggingFile} A logger instance.
 */
function createLogger(type, options, eventEmitter) {
  let logger;
  if (type === 'file') {
    logger = new loggingFile(options, eventEmitter);
  } else {
    logger = new logging(options, eventEmitter);
  }
  Routes(options, eventEmitter, logger);
  Views(options, eventEmitter, logger);
  return logger;
}

module.exports = createLogger;
