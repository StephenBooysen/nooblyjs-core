/**
 * @fileoverview A Memcached-backed cache implementation.
 */

const { Client } = require('memjs');

/**
 * A class that implements a Memcached-backed cache.
 */
class CacheMemcached {
  /**
   * Initializes the Memcached client.
   * @param {Object=} options The connection options for the Memcached client.
   * @param {string} options.url The Memcached connection URL.
   */
  constructor(options, eventEmitter) {
    if (!options || !options.url) {
      throw new Error('Memcached connection URL is required.');
    }
    /** @private @const {!Client} */
    this.client_ = Client.create(options.url);
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds a value to the cache.
   * @param {string} key The key to store the value under.
   * @param {*} value The value to store.
   * @param {number=} ttl Optional time-to-live in seconds.
   * @return {!Promise<void>}
   */
  async put(key, value, ttl) {
    // Memcached stores values as strings, so we need to stringify objects.
    const stringValue =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    await this.client_.set(key, stringValue, { expires: ttl || 0 });
    if (this.eventEmitter_)
      this.eventEmitter_.emit('cache:put', { key, value, ttl });
  }

  /**
   * Retrieves a value from the cache.
   * @param {string} key The key to retrieve the value for.
   * @return {!Promise<*|null>}
   */
  async get(key) {
    const { value } = await this.client_.get(key);
    if (value === null) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:get', { key, value: null });
      return null;
    }
    // Attempt to parse as JSON, otherwise return as string.
    try {
      const parsedValue = JSON.parse(value.toString());
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:get', { key, value: parsedValue });
      return parsedValue;
    } catch (e) {
      const stringValue = value.toString();
      if (this.eventEmitter_)
        this.eventEmitter_.emit('cache:get', { key, value: stringValue });
      return stringValue;
    }
  }

  /**
   * Deletes a value from the cache.
   * @param {string} key The key to delete.
   * @return {!Promise<void>}
   */
  async delete(key) {
    await this.client_.delete(key);
    if (this.eventEmitter_) this.eventEmitter_.emit('cache:delete', { key });
  }
}

module.exports = CacheMemcached;
