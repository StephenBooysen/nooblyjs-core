/**
 * @fileoverview In-memory DataRing provider.
 */

const { v4: uuidv4 } = require('uuid');

class DataServeProvider {
  constructor(options, eventEmitter) {
    this.containers = new Map(); // Map<containerName, Map<objectKey, object>>
    this.eventEmitter_ = eventEmitter;
  }

  async createContainer(containerName) {
    if (this.containers.has(containerName)) {
      throw new Error(`Container '${containerName}' already exists.`);
    }
    this.containers.set(containerName, new Map());
    if (this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:createContainer', { containerName });
  }

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

  async remove(containerName, objectKey) {
    if (!this.containers.has(containerName)) {
      return false;
    }
    const removed = this.containers.get(containerName).delete(objectKey);
    if (removed && this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:remove', { containerName, objectKey });
    return removed;
  }

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
        results.push({ key, obj });
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
