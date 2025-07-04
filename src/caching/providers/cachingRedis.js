/**
 * @fileoverview A Redis-backed cache implementation.
 */

const Redis = require('ioredis');

/**
 * A class that implements a Redis-backed cache.
 */
class CacheRedis {
  /**
   * Initializes the Redis client.
   * @param {Object=} options The connection options for the Redis client.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Redis} */
    this.client_ = new Redis(options);
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   * @return {!Promise<void>}
   */
  async put(key, value) {
    await this.client_.set(key, value);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:put', { key, value });
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {!Promise<*|null>}
   */
  async get(key) {
    const value = await this.client_.get(key);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:get', { key, value });
    return value;
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {!Promise<void>}
   */
  async delete(key) {
    await this.client_.del(key);
    if (this.eventEmitter_) this.eventEmitter_.emit('cache:delete', { key });
  }
}

module.exports = CacheRedis;
