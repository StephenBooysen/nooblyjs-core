/**
 * @fileoverview Logging Service Factory
 * Factory module for creating logging service instances with multiple provider support.
 * Supports console and file-based logging with configurable levels and formatting.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const logging = require('./providers/logging');
const loggingFile = require('./providers/loggingFile');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a logging service instance with the specified provider.
 * Automatically configures routes and views for the logging service.
 * @param {string} type - The logging provider type ('console', 'file')
 * @param {Object} options - Provider-specific configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {logging|loggingFile} Logging service instance with specified provider
 */
function createLogger(type, options, eventEmitter) {
  let logger;
  
  // Create logger instance based on provider type
  switch (type) {
    case 'file':
      logger = new loggingFile(options, eventEmitter);
      break;
    case 'console':
    default:
      logger = new logging(options, eventEmitter);
      break;
  }
  
  // Initialize routes and views for the logging service
  Routes(options, eventEmitter, logger);
  Views(options, eventEmitter, logger);
  
  return logger;
}

module.exports = createLogger;
