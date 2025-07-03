/**
 * @fileoverview Factory for creating cache instances.
 */

const Cache = require('./providers/caching');
const CacheRedis = require('./providers/cachingRedis');
const CacheMemcached = require('./providers/cachingMemcached');
const cachingRoutes = require('./routes');

/**
 * Creates a cache instance based on the provided type.
 * @param {string} type The type of cache to create. Valid options are 'memory', 'redis', and 'memcached'.
 * @param {Object=} options The connection options for the Redis or Memcached client.
 * @return {!Cache|!CacheRedis} A cache instance.
 */
function createCache(type, options, eventEmitter) {
  cachingRoutes(options);
  if (type === 'redis') {
    return new CacheRedis(options, eventEmitter);
  } else if (type === 'memcached') {
    return new CacheMemcached(options, eventEmitter);
  } else {
    return new Cache(options, eventEmitter);
  }
}
module.exports = createCache;