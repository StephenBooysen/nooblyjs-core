/**
 * @fileoverview Factory for creating cache instances.
 */

const Cache = require('./providers/cache');
const CacheRedis = require('./providers/cacheRedis');
const CacheMemcached = require('./providers/cacheMemcached');

/**
 * Creates a cache instance based on the provided type.
 * @param {string} type The type of cache to create. Valid options are 'memory', 'redis', and 'memcached'.
 * @param {Object=} options The connection options for the Redis or Memcached client.
 * @return {!Cache|!CacheRedis} A cache instance.
 */
function createCache(type, options, eventEmitter) {
  if (type === 'redis') {
    return new CacheRedis(options, eventEmitter);
  } else if (type === 'memcached') {
    return new CacheMemcached(options, eventEmitter);
  } else {
    return new Cache(eventEmitter);
  }
}

module.exports = createCache;
