/**
 * @fileoverview Factory for creating cache instances.
 */

const Cache = require('./providers/caching');
const CacheRedis = require('./providers/cachingRedis');
const CacheMemcached = require('./providers/cachingMemcached');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a cache instance based on the provided type.
 * @param {string} type The type of cache to create. Valid options are 'memory', 'redis', and 'memcached'.
 * @param {Object=} options The connection options for the Redis or Memcached client.
 * @return {!Cache|!CacheRedis} A cache instance.
 */
function createCache(type, options, eventEmitter) {
  let cache;
  if (type === 'redis') {
    cache = new CacheRedis(options, eventEmitter);
  } else if (type === 'memcached') {
    cache = new CacheMemcached(options, eventEmitter);
  } else {
    cache = new Cache(options, eventEmitter);
  }
  Routes(options, eventEmitter, cache);
  Views(options, eventEmitter, cache);
  return cache;
}

module.exports = createCache;
