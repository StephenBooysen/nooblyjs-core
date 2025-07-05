/**
 * @fileoverview File-based DataRing provider.
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class DataServeFileProvider {
  constructor(options, eventEmitter) {
    this.baseDir = path.resolve(options.baseDir || './dataserve_data');
    this.containers = new Map(); // Map<containerName, containerFilePath>
    this.eventEmitter_ = eventEmitter;
  }

  async _getContainerFilePath(containerName) {
    const containerFilePath = path.join(this.baseDir, `${containerName}.json`);
    if (!this.containers.has(containerName)) {
      try {
        await fs.access(containerFilePath);
        this.containers.set(containerName, containerFilePath);
      } catch (error) {
        // Container file does not exist, it will be created on first add
      }
    }
    return containerFilePath;
  }

  async _readContainerData(containerName) {
    const containerFilePath = await this._getContainerFilePath(containerName);
    try {
      const data = await fs.readFile(containerFilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {}; // Return empty object if file doesn't exist
      }
      throw error;
    }
  }

  async _writeContainerData(containerName, data) {
    const containerFilePath = await this._getContainerFilePath(containerName);
    await fs.mkdir(path.dirname(containerFilePath), { recursive: true });
    await fs.writeFile(containerFilePath, JSON.stringify(data, null, 2));
  }

  async createContainer(containerName) {
    const containerFilePath = path.join(this.baseDir, `${containerName}.json`);
    try {
      await fs.access(containerFilePath);
      throw new Error(`Container '${containerName}' already exists.`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Container does not exist, create an empty file for it
        await this._writeContainerData(containerName, {});
        this.containers.set(containerName, containerFilePath);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('dataserve:createContainer', {
            containerName,
          });
      } else {
        throw error;
      }
    }
  }

  async add(containerName, jsonObject) {
    const data = await this._readContainerData(containerName);
    const objectKey = uuidv4();
    data[objectKey] = jsonObject;
    await this._writeContainerData(containerName, data);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('dataserve:add', {
        containerName,
        objectKey,
        jsonObject,
      });
    return objectKey;
  }

  async remove(containerName, objectKey) {
    const data = await this._readContainerData(containerName);
    if (data[objectKey]) {
      delete data[objectKey];
      await this._writeContainerData(containerName, data);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('dataserve:remove', {
          containerName,
          objectKey,
        });
      return true;
    }
    return false;
  }

  async find(containerName, searchTerm) {
    const data = await this._readContainerData(containerName);
    const results = [];
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const obj = data[key];
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

module.exports = FileDataRingProvider;
