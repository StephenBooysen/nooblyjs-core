/**
 * @fileoverview Base class for MongoDB-compatible DataService providers.
 * Provides shared logic for CRUD operations, search, and connection management.
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Base class for MongoDB-compatible data storage providers.
 * @class
 */
class MongoBaseProvider {
  /**
   * Initializes the base provider.
   * @param {string} serviceType The type of service (e.g., 'mongodb', 'documentdb').
   * @param {Object} options Configuration options.
   * @param {EventEmitter=} eventEmitter Optional event emitter.
   */
  constructor(serviceType, options = {}, eventEmitter) {
    /** @protected @const {string} */
    this.serviceType_ = serviceType;
    
    /** @protected @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
    
    /** @protected @type {MongoClient|null} */
    this.client_ = null;
    
    /** @protected @type {Object|null} */
    this.db_ = null;
    
    /** @protected @const {Set<string>} */
    this.initializedContainers_ = new Set();

    // Shared settings
    this.settings = {
      description: `Configuration settings for the DataService ${serviceType.toUpperCase()} Provider`,
      list: [
        {setting: "connectionTimeout", type: "number", values: [30000]},
        {setting: "queryTimeout", type: "number", values: [60000]},
        {setting: "maxConnections", type: "number", values: [100]}
      ]
    };
    
    this.settings.connectionTimeout = options.connectionTimeout || 30000;
    this.settings.queryTimeout = options.queryTimeout || 60000;
    this.settings.maxConnections = options.maxConnections || 100;
  }

  /**
   * Emits a service-specific event.
   * @param {string} event The event name suffix.
   * @param {Object=} data The event data.
   * @protected
   */
  emitEvent_(event, data = {}) {
    if (this.eventEmitter_) {
      this.eventEmitter_.emit(`api-dataservice-${this.serviceType_}:${event}`, data);
    }
  }

  /**
   * Ensures connection is established.
   * @protected
   */
  async ensureConnection_() {
    if (!this.client_ || !this.db_) {
      await this.initializeConnection_();
    }
  }

  /**
   * Gets a collection (container).
   * @param {string} containerName The name of the container/collection.
   * @return {Object} Collection object.
   * @protected
   */
  getCollection_(containerName) {
    return this.db_.collection(containerName);
  }

  /**
   * Cleans MongoDB-specific fields from a document.
   * @param {Object} doc The document to clean.
   * @return {Object} The cleaned object.
   * @protected
   */
  _cleanDocument(doc) {
    if (!doc) return null;
    const { _id, uuid, _createdAt, _updatedAt, ...cleanObject } = doc;
    return cleanObject;
  }

  /**
   * Recursively searches an object for a regex pattern.
   * @param {Object} obj The object to search.
   * @param {RegExp} searchRegex The regex pattern to match.
   * @return {boolean} True if a match is found.
   * @protected
   */
  _searchInObject(obj, searchRegex) {
    for (const prop in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        const value = obj[prop];
        if (typeof value === 'string') {
          if (searchRegex.test(value)) {
            return true;
          }
        } else if (typeof value === 'object' && value !== null) {
          if (this._searchInObject(value, searchRegex)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Adds a JSON object to the specified container.
   * @param {string} containerName The name of the container.
   * @param {!Object} jsonObject The JSON object to store.
   * @return {Promise<string>} Unique key for the stored object.
   */
  async add(containerName, jsonObject) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const objectKey = uuidv4();
      
      const documentToInsert = {
        ...jsonObject,
        uuid: objectKey,
        _createdAt: new Date(),
        _updatedAt: new Date()
      };
      
      const result = await collection.insertOne(documentToInsert);
      
      this.emitEvent_('add', {
        containerName,
        objectKey,
        mongoId: result.insertedId
      });

      return objectKey;
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'add',
        containerName,
        error: error.message
      });
      throw new Error(`Failed to add object to container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Stores an object under a key the caller chooses (feature 12, the outbox).
   * A key that already exists is left as it is: the outbox repairs a record
   * this way, and it must be safe to repeat.
   *
   * @param {string} containerName
   * @param {string} objectKey
   * @param {Object} jsonObject
   * @return {Promise<string>} The key
   */
  async addWithKey(containerName, objectKey, jsonObject) {
    await this.ensureConnection_();
    if (!containerName || typeof containerName !== 'string' || containerName.trim() === '') {
      throw new Error('Invalid containerName: must be a non-empty string');
    }
    if (!objectKey || typeof objectKey !== 'string') throw new Error('Invalid objectKey: must be a non-empty string');
    try {
      await this.getCollection_(containerName).insertOne(this.keyedDocument_(objectKey, jsonObject));
    } catch (error) {
      if (error && error.code === 11000) return objectKey;
      throw new Error(`Failed to add object to container '${containerName}': ${error.message}`);
    }
    return objectKey;
  }

  /**
   * Document for a key-addressed insert.
   * @param {string} objectKey
   * @param {Object} jsonObject
   * @return {Object}
   * @private
   */
  keyedDocument_(objectKey, jsonObject) {
    const now = new Date();
    return { ...structuredClone(jsonObject), uuid: objectKey, _createdAt: now, _updatedAt: now };
  }

  /**
   * Gets a JSON object by UUID.
   * @param {string} containerName The name of the container.
   * @param {string} objectKey The unique UUID.
   * @return {Promise<Object|null>} The object or null.
   */
  async getByUuid(containerName, objectKey) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const result = await collection.findOne({ uuid: objectKey });
      
      if (result) {
        const cleanObject = this._cleanDocument(result);
        this.emitEvent_('getByUuid', {
          containerName,
          objectKey,
          obj: cleanObject
        });
        return cleanObject;
      }

      return null;
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'getByUuid',
        containerName,
        objectKey,
        error: error.message
      });
      throw new Error(`Failed to retrieve object from container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Removes a JSON object.
   * @param {string} containerName The name of the container.
   * @param {string} objectKey The unique key.
   * @return {Promise<boolean>} True if removed.
   */
  async remove(containerName, objectKey) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const result = await collection.deleteOne({ uuid: objectKey });
      
      const removed = result.deletedCount > 0;
      if (removed) {
        this.emitEvent_('remove', { containerName, objectKey });
      }

      return removed;
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'remove',
        containerName,
        objectKey,
        error: error.message
      });
      throw new Error(`Failed to remove object from container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Finds JSON objects using a cursor for scalability and regex escaping for security.
   * @param {string} containerName The name of the container.
   * @param {string} searchTerm The term to search for.
   * @return {Promise<Array<!Object>>} Matching objects.
   */
  async find(containerName, searchTerm) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const results = [];
      
      if (!searchTerm || searchTerm.trim() === '') {
        const cursor = collection.find({});
        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          results.push(this._cleanDocument(doc));
        }
      } else {
        const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(escapedTerm, 'i');
        const cursor = collection.find({});
        
        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          if (this._searchInObject(doc, searchRegex)) {
            results.push(this._cleanDocument(doc));
          }
        }
      }
      
      this.emitEvent_('find', {
        containerName,
        searchTerm,
        resultsCount: results.length
      });

      return results;
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'find',
        containerName,
        searchTerm,
        error: error.message
      });
      throw new Error(`Failed to search in container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Gets all objects in a container.
   */
  async listAll(containerName) {
    return this.find(containerName, '');
  }

  /**
   * Gets the count of objects in a container.
   */
  async count(containerName) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const count = await collection.countDocuments();
      this.emitEvent_('count', { containerName, count });
      return count;
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'count',
        containerName,
        error: error.message
      });
      throw new Error(`Failed to count objects in container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Replaces an existing object, as the other providers do: a field left out
   * of jsonObject is gone afterwards (the dataservice contract). Reports
   * whether the object existed, even when nothing in it changed.
   */
  async update(containerName, objectKey, jsonObject) {
    await this.ensureConnection_();

    try {
      const collection = this.getCollection_(containerName);
      const existing = await collection.findOne({ uuid: objectKey }, { projection: { _createdAt: 1 } });
      if (!existing) return false;
      const { _id, ...fields } = structuredClone(jsonObject);
      const updateDoc = {
        ...fields,
        uuid: objectKey,
        _createdAt: existing._createdAt,
        _updatedAt: new Date()
      };

      const result = await collection.replaceOne({ uuid: objectKey }, updateDoc);

      const updated = result.matchedCount > 0;
      if (updated) {
        this.emitEvent_('update', {
          containerName,
          objectKey,
          jsonObject: updateDoc
        });
      }

      return updated;
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'update',
        containerName,
        objectKey,
        error: error.message
      });
      throw new Error(`Failed to update object in container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Closes the connection.
   */
  async close() {
    if (this.client_) {
      try {
        await this.client_.close();
        this.client_ = null;
        this.db_ = null;
        this.emitEvent_('disconnected');
      } catch (error) {
        this.emitEvent_('error', {
          operation: 'close',
          error: error.message
        });
        throw error;
      }
    }
  }

  /**
   * Gets connection status.
   */
  get status() {
    return this.client_ && this.db_ ? 'connected' : 'disconnected';
  }

  async getSettings(){
    return this.settings;
  }

  async saveSettings(settings){
    for (let i = 0; i < this.settings.list.length; i++){
      const key = this.settings.list[i].setting;
      if (settings[key] != null){
        this.settings[key] = settings[key];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${key}`, {
          setting: key,
          newValue: settings[key]
        });
      }
    }
  }
}

module.exports = MongoBaseProvider;
