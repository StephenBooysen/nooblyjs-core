/**
 * @fileoverview Search service for loading and searching JSON objects.
 */

class SearchService {
  constructor(options, eventEmitter) {
    this.data = new Map(); // Stores objects with their keys
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds a JSON object to the search service with a unique key.
   * @param {object} jsonObject - The JSON object to add.
   * @returns {boolean} - True if the object was added, false if the key already exists.
   */
  async add(key, jsonObject) {
    if (this.data.has(key)) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('search:add:error', {
          sonObject: jsonObject,
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
   * @param {string} key - The key of the JSON object to remove.
   * @returns {boolean} - True if the object was removed, false if the key was not found.
   */
  async remove(key) {
    const removed = this.data.delete(key);
    if (removed && this.eventEmitter_)
      this.eventEmitter_.emit('search:remove', { key });
    return removed;
  }

  /**
   * Searches for a term across all string values within the stored JSON objects.
   * The search is case-insensitive.
   * @param {string} searchTerm - The term to search for.
   * @returns {Array<object>} - An array of JSON objects that contain the search term.
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
        results.push(key, obj);
      }
    }
    if (this.eventEmitter_)
      this.eventEmitter_.emit('search:search', { searchTerm, results });
    return results;
  }
}

module.exports = SearchService;
