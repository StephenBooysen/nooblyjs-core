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
const CacheMemcached = require('./providers/cachingMemcached');
const CacheFile = require('./providers/cachingFile');

const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a cache service instance with the specified provider.
 * Automatically configures routes and views for the cache service.
 * @param {string} type - The cache provider type ('memory', 'redis', 'memcached', 'file')
 * @param {Object} options - Provider-specific configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {Cache|CacheRedis|CacheMemcached|CacheFile} Cache service instance with specified provider
 * @throws {Error} When unsupported cache type is provided
 */
function createCache(type, options, eventEmitter) {
  let cache;

  // Create cache instance based on provider type
  switch (type) {
    case 'redis':
      cache = new CacheRedis(options, eventEmitter);
      break;
    case 'memcached':
      cache = new CacheMemcached(options, eventEmitter);
      break;
    case 'file':
      cache = new CacheFile(options, eventEmitter);
      break;
    case 'memory':
    default:
      cache = new Cache(options, eventEmitter);
      break;
  }

  // Initialize routes and views for the cache service
  Routes(options, eventEmitter, cache);
  Views(options, eventEmitter, cache);

  return cache;
}

module.exports = createCache;
