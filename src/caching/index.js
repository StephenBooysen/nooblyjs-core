/**
 * @fileoverview Caching Service Factory
 * Factory module for creating cache service instances with multiple provider support.
 * Supports memory, Redis, and Memcached backends with analytics and routing.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const Cache = require('./providers/caching');
const CacheRedis = require('./providers/cachingRedis');
const CacheFile = require('./providers/cachingFile');
const CacheApi = require('./providers/cachingApi');
const CacheAWS = require('./providers/cachingAWS');
const CacheAzure = require('./providers/cachingAzure');
const CacheGCP = require('./providers/cachingGCP');
const CacheAnalytics = require('./modules/analytics');

const Routes = require('./routes');
const Views = require('./views');
const Scripts = require('./scripts');

/**
 * Creates a cache service instance with the specified provider and dependency injection.
 * Automatically configures routes and views for the cache service.
 * @param {string} type - The cache provider type ('memory', 'redis', 'memcached', 'file', 'api', 'aws', 'azure', 'gcp')
 * @param {Object} options - Provider-specific configuration options
 * @param {string} [options.instanceName='default'] - Unique identifier for this cache instance
 * @param {number} [options.maxSize] - Maximum cache size (for memory provider)
 * @param {number} [options.ttl] - Default time-to-live in milliseconds
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {Cache|CacheRedis|CacheMemcached|CacheFile|CacheApi|CacheAWS|CacheAzure|CacheGCP} Cache service instance with specified provider
 * @throws {Error} When unsupported cache type is provided
 * @example
 * const cacheService = createCache('memory', {
 *   instanceName: 'api-cache',
 *   maxSize: 1000,
 *   ttl: 3600000, // 1 hour
 *   dependencies: { logging }
 * }, eventEmitter);
 *
 * // Set a cache entry
 * await cacheService.set('user:123', { name: 'John Doe', email: 'john@example.com' });
 *
 * // Get a cache entry
 * const user = await cacheService.get('user:123');
 *
 * // Delete a cache entry
 * await cacheService.delete('user:123');
 *
 * // Get cache statistics
 * const stats = cacheService.analytics.getAnalytics();
 * console.log(`Hit rate: ${stats.hitRate}%`);
 */
function createCache(type, options, eventEmitter) {
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;

  let cache;

  // Create cache instance based on provider type
  switch (type) {
    case 'redis':
      cache = new CacheRedis(providerOptions, eventEmitter);
      break;
    case 'memcached':
      // Feature 20b: loaded on demand; memjs is an optional peer dependency.
      cache = new (require('./providers/cachingMemcached'))(providerOptions, eventEmitter);
      break;
    case 'file':
      cache = new CacheFile(providerOptions, eventEmitter);
      break;
    case 'api':
      cache = new CacheApi(providerOptions, eventEmitter);
      break;
    case 'aws':
      cache = new CacheAWS(providerOptions, eventEmitter);
      break;
    case 'azure':
      cache = new CacheAzure(providerOptions, eventEmitter);
      break;
    case 'gcp':
      cache = new CacheGCP(providerOptions, eventEmitter);
      break;
    case 'memory':
    default:
      cache = new Cache(providerOptions, eventEmitter);
      break;
  }

  // Inject logging dependency into cache service
  if (logger) {
    cache.logger = logger;
    cache.log = (level, message, meta = {}) => {
      if (typeof logger[level] === 'function') {
        logger[level](`[CACHE:${type.toUpperCase()}] ${message}`, meta);
      }
    };

    // Log cache service initialization
    cache.log('info', 'Cache service initialized', {
      provider: type,
      hasLogging: true
    });
  }

  // Store dependencies for potential use by provider
  cache.dependencies = dependencies;

  // Initialize analytics module
  if (eventEmitter) {
    const instanceName = (providerOptions && providerOptions.instanceName) || 'default';
    cache.analytics = new CacheAnalytics(eventEmitter, instanceName);

    if (logger) {
      cache.log('info', 'Cache analytics initialized', {
        provider: type,
        instance: instanceName
      });
    }
  }

  // Initialize routes and views for the cache service
  Routes(options, eventEmitter, cache);
  Views(options, eventEmitter, cache);
  Scripts(options, eventEmitter, cache);

  return cache;
}

module.exports = createCache;
