/**
 * @fileoverview A simple in-memory cache implementation.
 */

/**
 * A class that implements a simple in-memory cache.
 */
class Cache {
  /**
   * Initializes the cache.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Object<string, *>} */
    this.cache_ = {};
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   */
  async put(key, value) {
    this.cache_[key] = value;
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:put', { key, value });
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {*} The cached value, or undefined if the key is not found.
   */
  async get(key) {
    const value = this.cache_[key];
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:get', { key, value });
    return value;
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   */
  async delete(key) {
    delete this.cache_[key];
    if (this.eventEmitter_) this.eventEmitter_.emit('cache:delete', { key });
  }
}

module.exports = Cache;
