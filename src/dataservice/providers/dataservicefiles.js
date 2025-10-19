/**
 * @fileoverview File-based DataService provider for persistent storage of JSON objects
 * using the file system with container-based organization.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * A class that implements a file-based data storage provider.
 * Stores JSON objects persistently in the file system using JSON files.
 * @class
 */
class FileDataRingProvider {
  /**
   * Initializes the file-based data storage provider.
   * @param {Object} options Configuration options for the provider.
   * @param {string=} options.baseDir Base directory for storing data files (defaults to './dataservice_data').
   * @param {EventEmitter=} eventEmitter Optional event emitter for data operations.
   */
  constructor(options, eventEmitter) {
    /** @private @const {string} */
    this.baseDir = path.resolve(options.baseDir || './.data');
    /** @private @const {!Map<string, string>} */
    this.containers = new Map(); // Map<containerName, containerFilePath>
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    // Settings for dataservice file provider
    this.settings = {};
    this.settings.description = "Configuration settings for the DataService File Provider";
    this.settings.list = [
      {setting: "storageLocation", type: "string", values: ["./.data"]},
      {setting: "maxFileSize", type: "number", values: [10485760]},
      {setting: "autoBackup", type: "boolean", values: [false]}
    ];
    this.settings.storageLocation = options.storageLocation || this.settings.list[0].values[0];
    this.settings.maxFileSize = options.maxFileSize || this.settings.list[1].values[0];
    this.settings.autoBackup = options.autoBackup || this.settings.list[2].values[0];
  }

  /**
   * Gets the file path for a container.
   * @param {string} containerName The name of the container.
   * @return {Promise<string>} A promise that resolves to the container file path.
   * @private
   */
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
  async _writeContainerData(containerName, data) {
    const containerFilePath = await this._getContainerFilePath(containerName);
    await fs.mkdir(path.dirname(containerFilePath), { recursive: true });
    await fs.writeFile(containerFilePath, JSON.stringify(data, null, 2));
  }

  /**
   * Creates a new container for storing JSON objects.
   * @param {string} containerName The name of the container to create.
   * @return {Promise<void>} A promise that resolves when the container is created.
   * @throws {Error} When a container with the same name already exists.
   */
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
    const data = await this._readContainerData(containerName);
    const objectKey = uuidv4();
    data[objectKey] = jsonObject;
    await this._writeContainerData(containerName, data);
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
    const data = await this._readContainerData(containerName);
    if (data[objectKey]) {
      delete data[objectKey];
      await this._writeContainerData(containerName, data);
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
   * Finds JSON objects in the specified container that contain the search term.
   * @param {string} containerName The name of the container to search in.
   * @param {string} searchTerm The term to search for (case-insensitive).
   * @return {Promise<Array<!Object>>} A promise that resolves to an array of matching objects.
   */
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
      this.eventEmitter_.emit('api-dataservice-find', {
        containerName,
        searchTerm,
        results,
      });
    return results;
  }

  /**
   * Get all settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Save/update settings
   */
  async saveSettings(settings){
    for (let i = 0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        console.log(this.settings.list[i].setting + ' changed to: ' + settings[this.settings.list[i].setting]);
      }
    }
  }
}

module.exports = FileDataRingProvider;
