/**
 * @fileoverview In-memory DataServe provider for storing and searching JSON objects
 * with container-based organization and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * A class that implements an in-memory data storage provider.
 * Provides methods for creating containers and storing, retrieving, and searching JSON objects.
 * @class
 */
class InMemoryDataServeProvider {
  /**
   * Initializes the in-memory data storage provider.
   * @param {Object=} options Configuration options (unused in this implementation).
   * @param {EventEmitter=} eventEmitter Optional event emitter for data operations.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Map<string, !Map<string, !Object>>} */
    this.containers = new Map(); // Map<containerName, Map<objectKey, object>>
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Creates a new container for storing JSON objects.
   * @param {string} containerName The name of the container to create.
   * @return {Promise<void>} A promise that resolves when the container is created.
   * @throws {Error} When a container with the same name already exists.
   */
  async createContainer(containerName) {
    if (this.containers.has(containerName)) {
      return;
    }
    this.containers.set(containerName, new Map());
    if (this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:createContainer', { containerName });
  }

  /**
   * Adds a JSON object to the specified container.
   * @param {string} containerName The name of the container to add the object to.
   * @param {!Object} jsonObject The JSON object to store.
   * @return {Promise<string>} A promise that resolves to the unique key for the stored object.
   * @throws {Error} When the specified container does not exist.
   */
  async add(containerName, jsonObject) {
    if (!this.containers.has(containerName)) {
      throw new Error(`Container '${containerName}' does not exist.`);
    }
    const objectKey = uuidv4();
    this.containers.get(containerName).set(objectKey, jsonObject);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:add', {
        containerName,
        objectKey,
        jsonObject,
      });
    return objectKey;
  }

  /**
   * Gets a JSON object from the specified container by UUID.
   * @param {string} containerName The name of the container to retrieve the object from.
   * @param {string} objectKey The unique UUID of the object to retrieve.
   * @return {Promise<Object|null>} A promise that resolves to the object or null if not found.
   */
  async getByUuid(containerName, objectKey) {
    if (!this.containers.has(containerName)) {
      return null;
    }
    const obj = this.containers.get(containerName).get(objectKey);
    if (obj && this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:getByUuid', { containerName, objectKey, obj });
    return obj || null;
  }

  /**
   * Removes a JSON object from the specified container.
   * @param {string} containerName The name of the container to remove the object from.
   * @param {string} objectKey The unique key of the object to remove.
   * @return {Promise<boolean>} A promise that resolves to true if the object was removed, false otherwise.
   */
  async remove(containerName, objectKey) {
    if (!this.containers.has(containerName)) {
      return false;
    }
    const removed = this.containers.get(containerName).delete(objectKey);
    if (removed && this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:remove', { containerName, objectKey });
    return removed;
  }

  /**
   * Finds JSON objects in the specified container that contain the search term.
   * Performs a recursive search through all string values in the objects.
   * @param {string} containerName The name of the container to search in.
   * @param {string} searchTerm The term to search for (case-insensitive).
   * @return {Promise<Array<!Object>>} A promise that resolves to an array of matching objects.
   */
  async find(containerName, searchTerm) {
    if (!this.containers.has(containerName)) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('dataserve:find', {
          containerName,
          searchTerm,
          results: [],
        });
      return [];
    }
    const results = [];
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    for (const [key, obj] of this.containers.get(containerName).entries()) {
      let found = false;
      const searchInObject = (currentObj) => {
        for (const prop in currentObj) {
          if (Object.prototype.hasOwnProperty.call(currentObj, prop)) {
            const value = currentObj[prop];
            if (typeof value === 'string') {
              if (value.toLowerCase().includes(lowerCaseSearchTerm)) {
                found = true;
                return;
              }
            } else if (typeof value === 'object' && value !== null) {
              searchInObject(value);
              if (found) return;
            }
          }
        }
      };

      searchInObject(obj);
      if (found) {
        results.push(obj);
      }
    }
    if (this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:find', {
        containerName,
        searchTerm,
        results,
      });
    return results;
  }
}

module.exports = InMemoryDataServeProvider;
