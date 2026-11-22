/**
 * @fileoverview File-based DataService provider for persistent storage of JSON objects
 * using the file system with container-based organization.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const outbox = require('../modules/outbox');

const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');

// Windows can hold a file briefly (an indexer, an antivirus scan), which makes rename fail.
const RENAME_RETRIES = [10, 30, 100, 300];

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      const busy = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES';
      if (!busy || attempt >= RENAME_RETRIES.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRIES[attempt]));
    }
  }
}

/**
 * A class that implements a file-based data storage provider.
 * Stores JSON objects persistently in the file system using JSON files.
 * @class
 */
class FileDataRingProvider {
  /**
   * Initializes the file-based data storage provider.
   * @param {Object} options Configuration options for the provider.
   * @param {string=} options.dataDir Base directory for storing data files (defaults to './dataservice_data').
   * @param {EventEmitter=} eventEmitter Optional event emitter for data operations.
   */
  constructor(options, eventEmitter) {
    // Support both 'dataDir' and 'baseDir' options for backward compatibility.
    // Fall back to the documented default so the provider can be created
    // without an explicit directory (path.resolve(undefined) would otherwise
    // throw "The \"paths[0]\" argument must be of type string").
    this.dataDir = path.resolve(options.dataDir || options.baseDir || './dataservice_data');

    this.containers = new Map(); 
    // Per-container tail of the write queue: add/update/remove read the whole
    // container file, change it and write it back, so they must not overlap.
    this.writeLocks_ = new Map();
    this.eventEmitter_ = eventEmitter;

    // Settings for dataservice file provider
    this.settings = {};
    this.settings.description = "Configuration settings for the DataService File Provider";
    this.settings.list = [
      {setting: "storageLocation", type: "string", values: ["./.application"]},
      {setting: "maxFileSize", type: "number", values: [10485760]},
      {setting: "autoBackup", type: "boolean", values: [false]}
    ];
    this.settings.storageLocation = options.storageLocation || this.settings.list[0].values[0];
    this.settings.maxFileSize = options.maxFileSize || this.settings.list[1].values[0];
    this.settings.autoBackup = options.autoBackup || this.settings.list[2].values[0];
  }

  /**
   * Validates that a container name is safe to use as a filename component,
   * preventing path traversal (e.g. "../../etc/passwd") or absolute paths from
   * escaping the data directory.
   * @param {string} containerName The container name to validate.
   * @return {string} The validated container name.
   * @throws {Error} When the name is empty or contains path separators / traversal.
   * @private
   */
  _validateContainerName(containerName) {
    if (!containerName || typeof containerName !== 'string' || containerName.trim() === '') {
      throw new Error('Invalid containerName: must be a non-empty string');
    }
    // Reject any path separators or parent-directory references. Container
    // names must be a single filesystem-safe segment. path.basename() would
    // silently strip directories; we reject instead so callers get a clear
    // error rather than a surprising file location.
    if (/[\\/]/.test(containerName) || containerName === '.' || containerName === '..'
        || containerName.split(/[\\/]/).includes('..')) {
      throw new Error('Invalid containerName: must not contain path separators or traversal segments');
    }
    return containerName;
  }

  /**
   * Validates that an object key is safe to use as a property accessor,
   * preventing prototype pollution via keys like "__proto__", "constructor",
   * or "prototype". User-supplied keys reach data[objectKey] assignments, so
   * a malicious key could otherwise alter Object.prototype for the process.
   * @param {string} objectKey The object key to validate.
   * @return {string} The validated object key.
   * @throws {Error} When the key is empty or a dangerous prototype-chain key.
   * @private
   */
  _assertSafeKey(objectKey) {
    if (!objectKey || typeof objectKey !== 'string' || objectKey.trim() === '') {
      throw new Error('Invalid objectKey: must be a non-empty string');
    }
    if (objectKey === '__proto__' || objectKey === 'constructor' || objectKey === 'prototype') {
      throw new Error('Invalid objectKey: reserved prototype key is not allowed');
    }
    return objectKey;
  }

  /**
   * Gets the file path for a container.
   * @param {string} containerName The name of the container.
   * @return {Promise<string>} A promise that resolves to the container file path.
   * @private
   */
  async _getContainerFilePath(containerName) {
    this._validateContainerName(containerName);
    const containerFilePath = path.join(this.dataDir, `${containerName}.json`);
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

  /**
   * Reads data from a container file.
   * @param {string} containerName The name of the container to read from.
   * @return {Promise<Object>} A promise that resolves to the container data.
   * @throws {Error} When file read fails.
   * @private
   */
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

  /**
   * Writes data to a container file.
   * @param {string} containerName The name of the container to write to.
   * @param {!Object} data The data to write to the container.
   * @return {Promise<void>} A promise that resolves when the data is written.
   * @throws {Error} When file write fails.
   * @private
   */
  /**
   * Runs a read-modify-write of a container file after any in-flight one for
   * the same container has finished. Without this, concurrent adds each read
   * the same snapshot and all but the last write were lost.
   * @param {string} containerName The container being modified.
   * @param {function(): Promise<*>} fn The read-modify-write to run.
   * @return {Promise<*>} The result of fn.
   * @private
   */
  async _withContainerLock(containerName, fn) {
    const previous = this.writeLocks_.get(containerName) || Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    this.writeLocks_.set(containerName, tail);
    try {
      return await run;
    } finally {
      if (this.writeLocks_.get(containerName) === tail) {
        this.writeLocks_.delete(containerName);
      }
    }
  }

  async _writeContainerData(containerName, data) {
    const containerFilePath = await this._getContainerFilePath(containerName);
    await fs.mkdir(path.dirname(containerFilePath), { recursive: true });
    // Atomic: write a temp file, fsync, rename over the container file. Reads take no lock, so writing in place
    // (truncate, then write) let a reader see an empty or half-written file and fail to parse it.
    const tmp = `${containerFilePath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await renameWithRetry(tmp, containerFilePath);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  /**
   * Creates a new container for storing JSON objects.
   * @param {string} containerName The name of the container to create.
   * @return {Promise<void>} A promise that resolves when the container is created.
   * @throws {Error} When a container with the same name already exists.
   */
  async createContainer(containerName) {
    try {
      this._validateContainerName(containerName);
    } catch (validationError) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'createContainer', error: validationError.message, containerName });
      }
      throw validationError;
    }

    const containerFilePath = path.join(this.dataDir, `${containerName}.json`);
    try {
      await fs.access(containerFilePath);
      throw new Error(`Container '${containerName}' already exists.`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Container does not exist, create an empty file for it
        await this._writeContainerData(containerName, {});
        this.containers.set(containerName, containerFilePath);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('api-dataservice-createContainer', {
            containerName,
          });
      } else {
        throw error;
      }
    }
  }

  /**
   * Adds a JSON object to the specified container.
   * @param {string} containerName The name of the container to add the object to.
   * @param {!Object} jsonObject The JSON object to store.
   * @return {Promise<string>} A promise that resolves to the unique key for the stored object.
   * @throws {Error} When file operations fail.
   */
  async add(containerName, jsonObject) {
    // Validate containerName parameter
    if (!containerName || typeof containerName !== 'string' || containerName.trim() === '') {
      const error = new Error('Invalid containerName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', {
          method: 'add',
          error: error.message,
          containerName
        });
      }
      throw error;
    }

    // Validate jsonObject parameter
    if (!jsonObject || typeof jsonObject !== 'object' || Array.isArray(jsonObject)) {
      const error = new Error('Invalid jsonObject: must be a non-null object');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', {
          method: 'add',
          error: error.message,
          containerName
        });
      }
      throw error;
    }

    const objectKey = uuidv4();
    await this._withContainerLock(containerName, async () => {
      const data = await this._readContainerData(containerName);
      data[objectKey] = jsonObject;
      await this._writeContainerData(containerName, data);
    });
    if (this.eventEmitter_)
      this.eventEmitter_.emit('api-dataservice-add', {
        containerName,
        objectKey,
        jsonObject,
      });
    return objectKey;
  }

  /**
   * Removes a JSON object from the specified container.
   * @param {string} containerName The name of the container to remove the object from.
   * @param {string} objectKey The unique key of the object to remove.
   * @return {Promise<boolean>} A promise that resolves to true if the object was removed, false otherwise.
   */
  async remove(containerName, objectKey) {
    if (!containerName || typeof containerName !== 'string' || containerName.trim() === '') {
      const error = new Error('Invalid containerName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'remove', error: error.message, containerName });
      }
      throw error;
    }
    if (!objectKey || typeof objectKey !== 'string' || objectKey.trim() === '') {
      const error = new Error('Invalid objectKey: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'remove', error: error.message, containerName, objectKey });
      }
      throw error;
    }
    try {
      this._assertSafeKey(objectKey);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'remove', error: error.message, containerName, objectKey });
      }
      throw error;
    }

    const removed = await this._withContainerLock(containerName, async () => {
      const data = await this._readContainerData(containerName);
      if (!Object.prototype.hasOwnProperty.call(data, objectKey)) {
        return false;
      }
      delete data[objectKey];
      await this._writeContainerData(containerName, data);
      return true;
    });
    if (removed) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('api-dataservice-remove', {
          containerName,
          objectKey,
        });
      return true;
    }
    return false;
  }

  /**
   * Gets a JSON object from the specified container by UUID.
   * @param {string} containerName The name of the container to retrieve the object from.
   * @param {string} objectKey The unique UUID of the object to retrieve.
   * @return {Promise<Object|null>} A promise that resolves to the object or null if not found.
   */
  async getByUuid(containerName, objectKey) {
    if (!containerName || typeof containerName !== 'string' || containerName.trim() === '') {
      const error = new Error('Invalid containerName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'getByUuid', error: error.message, containerName });
      }
      throw error;
    }
    if (!objectKey || typeof objectKey !== 'string' || objectKey.trim() === '') {
      const error = new Error('Invalid objectKey: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'getByUuid', error: error.message, containerName, objectKey });
      }
      throw error;
    }
    try {
      this._assertSafeKey(objectKey);
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'getByUuid', error: error.message, containerName, objectKey });
      }
      throw error;
    }

    try {
      const data = await this._readContainerData(containerName);
      const obj = Object.prototype.hasOwnProperty.call(data, objectKey) ? data[objectKey] : undefined;

      if (obj && this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-getByUuid', {
          containerName,
          objectKey,
          obj
        });
      }

      return obj || null;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-error', {
          operation: 'getByUuid',
          containerName,
          objectKey,
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Finds JSON objects in the specified container that contain the search term.
   * @param {string} containerName The name of the container to search in.
   * @param {string} searchTerm The term to search for (case-insensitive). Empty string returns all.
   * @return {Promise<Array<!Object>>} A promise that resolves to an array of matching objects.
   */
  async find(containerName, searchTerm = '') {
    if (!containerName || typeof containerName !== 'string' || containerName.trim() === '') {
      const error = new Error('Invalid containerName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-validation-error', { method: 'find', error: error.message, containerName });
      }
      throw error;
    }

    try {
      const data = await this._readContainerData(containerName);
      const results = [];

      // If no search term, return all objects
      if (!searchTerm || searchTerm.trim() === '') {
        for (const key in data) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            results.push(data[key]);
          }
        }
      } else {
        // Search with case-insensitive matching
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
      }

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-find', {
          containerName,
          searchTerm,
          results,
        });
      }

      return results;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-error', {
          operation: 'find',
          containerName,
          searchTerm,
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Gets all objects in a container.
   * @param {string} containerName The name of the container to list.
   * @return {Promise<Array<!Object>>} A promise that resolves to an array of all objects.
   */
  async listAll(containerName) {
    return this.find(containerName, '');
  }

  /**
   * Gets the count of objects in a container.
   * @param {string} containerName The name of the container to count.
   * @return {Promise<number>} A promise that resolves to the count of objects.
   */
  async count(containerName) {
    try {
      const data = await this._readContainerData(containerName);
      const count = Object.keys(data).length;

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-count', { containerName, count });
      }

      return count;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-error', {
          operation: 'count',
          containerName,
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Updates an existing object in the container.
   * @param {string} containerName The name of the container.
   * @param {string} objectKey The unique key of the object to update.
   * @param {!Object} jsonObject The updated JSON object.
   * @return {Promise<boolean>} A promise that resolves to true if updated, false if not found.
   */
  async update(containerName, objectKey, jsonObject) {
    try {
      this._assertSafeKey(objectKey);
      const updated = await this._withContainerLock(containerName, async () => {
        const data = await this._readContainerData(containerName);
        if (!Object.prototype.hasOwnProperty.call(data, objectKey)) {
          return false;
        }
        data[objectKey] = jsonObject;
        await this._writeContainerData(containerName, data);
        return true;
      });
      if (!updated) {
        return false;
      }

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-update', {
          containerName,
          objectKey,
          jsonObject
        });
      }

      return true;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('api-dataservice-error', {
          operation: 'update',
          containerName,
          objectKey,
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Get all settings
   * @return {Promise<Object>} The settings object.
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Save/update settings
   * @param {Object} settings The settings to save.
   * @return {Promise<void>}
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
      }
    }
  }

  /**
   * Closes the file data service provider (no-op for file provider).
   * @return {Promise<void>}
   */
  async close() {
    // No-op for file provider, included for API consistency
  }
  /**
   * Stores an object under a key the caller chooses. Used by the transactional
   * outbox, where both keys are known before the write, so repair is idempotent.
   * @param {string} containerName The container name.
   * @param {string} objectKey Key to store under.
   * @param {Object} jsonObject Object to store.
   * @return {Promise<string>} The key.
   */
  async addWithKey(containerName, objectKey, jsonObject) {
    this._validateContainerName(containerName);
    this._assertSafeKey(objectKey);
    await this._withContainerLock(containerName, async () => {
      const data = await this._readContainerData(containerName);
      data[objectKey] = jsonObject;
      await this._writeContainerData(containerName, data);
    });
    return objectKey;
  }

  /**
   * Writes an event and its record so the event is never lost (feature 12).
   * See modules/outbox.js.
   * @param {string} containerName Container for the record.
   * @param {Object} record Record to store.
   * @param {{name: string, payload?: *}} event Event to publish later.
   * @return {Promise<{key: string, eventId: string}>}
   */
  async addWithEvent(containerName, record, event) {
    return outbox.addWithEvent(this, containerName, record, event);
  }

  /**
   * Publishes pending outbox events (feature 12).
   * @param {function(Object): Promise<*>} publish Receives each event.
   * @param {Object=} options See modules/outbox.js.
   * @return {Promise<{published: number, failed: number}>}
   */
  async relayOutbox(publish, options) {
    return outbox.relayOutbox(this, publish, options);
  }

}

module.exports = FileDataRingProvider;
