/**
 * @fileoverview Fetching Service Factory
 * Factory module for creating fetching service instances with multiple provider support.
 * Supports axios and Node.js native fetch backends with analytics and routing.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const FetchingNode = require('./providers/fetchingnode');
const FetchingAxios = require('./providers/fetchingaxios');
const FetchingAnalytics = require('./modules/analytics');

const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a fetching service instance with the specified provider and dependency injection.
 * Automatically configures routes for the fetching service.
 * @param {string} type - The fetching provider type ('axios', 'node', 'api')
 * @param {Object} options - Provider-specific configuration options
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {FetchingNode|FetchingAxios} Fetching service instance with specified provider
 * @throws {Error} When unsupported fetching type is provided
 * @example
 * const fetchingService = createFetching('node', {
 *   dependencies: { logging }
 * }, eventEmitter);
 *
 * // Fetch data from a URL
 * const response = await fetchingService.fetch('https://api.example.com/data', {
 *   method: 'GET',
 *   headers: { 'Authorization': 'Bearer token' }
 * });
 * const data = await response.json();
 *
 * @example
 * // Using axios provider
 * const axiosFetching = createFetching('axios', {
 *   dependencies: { logging }
 * }, eventEmitter);
 *
 * const result = await axiosFetching.fetch('https://api.example.com/users');
 */
function createFetching(type, options, eventEmitter) {
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;

  let fetching;

  // Create fetching instance based on provider type
  switch (type) {
    case 'axios':
      fetching = new FetchingAxios(providerOptions, eventEmitter);
      break;
    case 'node':
    case 'default':
    default:
      fetching = new FetchingNode(providerOptions, eventEmitter);
      break;
  }

  // Inject logging dependency into fetching service
  if (logger) {
    fetching.logger = logger;
    fetching.log = (level, message, meta = {}) => {
      if (typeof logger[level] === 'function') {
        logger[level](`[FETCHING:${type.toUpperCase()}] ${message}`, meta);
      }
    };

    // Log fetching service initialization
    fetching.log('info', 'Fetching service initialized', {
      provider: type,
      hasLogging: true
    });
  }

  // Store dependencies for potential use by provider
  fetching.dependencies = dependencies;

  // Initialize analytics module
  if (eventEmitter) {
    fetching.analytics = new FetchingAnalytics(eventEmitter);

    if (logger) {
      fetching.log('info', 'Fetching analytics initialized', {
        provider: type
      });
    }
  }

  // Initialize routes for the fetching service
  Routes(options, eventEmitter, fetching);
  Views(options, eventEmitter, fetching);

  return fetching;
}

module.exports = createFetching;
