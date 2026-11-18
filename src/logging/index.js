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
const loggingApi = require('./providers/loggingApi');
const Routes = require('./routes');
const Views = require('./views');
const LogAnalytics = require('./modules/analytics');

/**
 * Creates a logging service instance with the specified provider.
 * Automatically configures routes and views for the logging service.
 * @param {string} type - The logging provider type ('memory', 'file', 'api')
 * @param {Object} options - Provider-specific configuration options
 * @param {string} [options.instanceName='default'] - Unique identifier for this logger instance
 * @param {string} [options.logDir] - Directory for log files (file provider)
 * @param {string} [options.level='info'] - Minimum log level to capture (debug, info, warn, error)
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {logging|loggingFile|loggingApi} Logging service instance with specified provider
 * @throws {Error} When unsupported logging type is provided
 * @example
 * const loggingService = createLogger('file', {
 *   instanceName: 'app-logger',
 *   logDir: './logs',
 *   level: 'info'
 * }, eventEmitter);
 *
 * // Log messages at different levels
 * loggingService.info('Application started', { version: '1.0.0' });
 * loggingService.warn('Deprecated API used', { endpoint: '/old-api' });
 * loggingService.error('Database connection failed', { error: err.message });
 * loggingService.debug('Processing request', { requestId: '123' });
 *
 * // Get log analytics
 * const stats = loggingService.analytics.getAnalytics();
 * console.log(`Total logs: ${stats.totalLogs}, Errors: ${stats.errorCount}`);
 */
function createLogger(type, options, eventEmitter) {
  let logger;

  // Initialize analytics module to capture logs
  let analytics = null;
  if (eventEmitter) {
    const instanceName = (options && options.instanceName) || 'default';
    analytics = new LogAnalytics(eventEmitter, instanceName);
  }

  // Create logger instance based on provider type
  switch (type) {
    case 'file':
      logger = new loggingFile(options, eventEmitter);
      break;
    case 'api':
      logger = new loggingApi(options, eventEmitter);
      break;
    case 'memory':
    default:
      logger = new logging(options, eventEmitter);
      break;
  }

  // Attach analytics to logger instance
  logger.analytics = analytics;

  // Initialize routes and views for the logging service
  Routes(options, eventEmitter, logger, analytics);
  Views(options, eventEmitter, logger);

  return logger;
}

module.exports = createLogger;
