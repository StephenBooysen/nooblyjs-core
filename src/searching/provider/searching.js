/**
 * @fileoverview Search service for loading and searching JSON objects
 * with recursive string matching and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * A class that implements a search service for JSON objects.
 * Provides methods for adding, removing, and searching through stored objects.
 * @class
 */
class SearchService {
  /**
   * Initializes the search service with empty data storage.
   * @param {Object=} options Configuration options (unused in this implementation).
   * @param {EventEmitter=} eventEmitter Optional event emitter for search events.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Map<string, !Object>} */
    this.data = new Map(); // Stores objects with their keys
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds a JSON object to the search service with a unique key.
   * @param {string} key The unique key for the JSON object.
   * @param {!Object} jsonObject The JSON object to add.
   * @return {Promise<boolean>} A promise that resolves to true if the object was added, false if the key already exists.
   */
  async add(key, jsonObject) {
    if (this.data.has(key)) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('search:add:error', {
          jsonObject: jsonObject,
          key: key,
          error: 'Key already exists.',
        });
      return false;
    }
    this.data.set(key, jsonObject);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('search:add', { jsonObject: jsonObject });
    return true;
  }

  /**
   * Removes a JSON object from the search service by its key.
   * @param {string} key The key of the JSON object to remove.
   * @return {Promise<boolean>} A promise that resolves to true if the object was removed, false if the key was not found.
   */
  async remove(key) {
    const removed = this.data.delete(key);
    if (removed && this.eventEmitter_)
      this.eventEmitter_.emit('search:remove', { key });
    return removed;
  }

  /**
   * Searches for a term across all string values within the stored JSON objects.
   * The search is case-insensitive and recursive through nested objects.
   * @param {string} searchTerm The term to search for.
   * @return {Promise<Array<!Object>>} A promise that resolves to an array of matching objects with their keys.
   */
  async search(searchTerm) {
    const results = [];
    if (!searchTerm) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('search:search', { searchTerm, results });
      return results;
    }
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    for (const [key, obj] of this.data.entries()) {
      let found = false;

      const searchInObject = (currentObj) => {
        for (const prop in currentObj) {
          if (Object.prototype.hasOwnProperty.call(currentObj, prop)) {
            const value = currentObj[prop];
            if (typeof value === 'string') {
              if (value.toLowerCase().includes(lowerCaseSearchTerm)) {
                found = true;
                return; // Found in this object, no need to search further
              }
            } else if (typeof value === 'object' && value !== null) {
              searchInObject(value); // Recurse for nested objects
              if (found) return; // If found in nested object, stop
            }
          }
        }
      };

      searchInObject(obj);
      if (found) {
        results.push({key, obj});
      }
    }
    if (this.eventEmitter_)
      this.eventEmitter_.emit('search:search', { searchTerm, results });
    return results;
  }
}

module.exports = SearchService;
