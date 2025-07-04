/**
 * @fileoverview Factory for creating cache instances.
 */

const Cache = require('./providers/caching');
const CacheRedis = require('./providers/cachingRedis');
const CacheMemcached = require('./providers/cachingMemcached');
const Routes = require('./routes');

/**
 * Creates a cache instance based on the provided type.
 * @param {string} type The type of cache to create. Valid options are 'memory', 'redis', and 'memcached'.
 * @param {Object=} options The connection options for the Redis or Memcached client.
 * @return {!Cache|!CacheRedis} A cache instance.
 */
function createCache(type, options, eventEmitter) {
  if (type === 'redis') {
    var cache = new CacheRedis(options, eventEmitter);
    Routes(options, eventEmitter, cache);
    return cache;
  } else if (type === 'memcached') {
    var cache = new CacheMemcached(options, eventEmitter);
    Routes(options, eventEmitter, cache);
    return cache;
  } else {
    var cache =  new Cache(options, eventEmitter);
    Routes(options, eventEmitter, cache);
    return cache;
  }
}

module.exports = createCache;
