/**
 * @fileoverview MongoDB DataServe provider for storing and searching JSON objects
 * with container-based organization using MongoDB collections and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

/**
 * A class that implements a MongoDB data storage provider.
 * Provides methods for creating containers (collections) and storing, retrieving, and searching JSON objects.
 * @class
 */
class MongoDBDataServeProvider {
  /**
   * Initializes the MongoDB data storage provider.
   * @param {Object=} options Configuration options for MongoDB connection.
   * @param {string=} options.connectionString MongoDB connection string (defaults to local MongoDB).
   * @param {string=} options.database Database name to use (defaults to 'nooblyjs').
   * @param {EventEmitter=} eventEmitter Optional event emitter for data operations.
   */
  constructor(options = {}, eventEmitter) {
    /** @private @const {string} */
    this.connectionString_ = options.connectionString || 'mongodb://127.0.0.1:27017';
    
    /** @private @const {string} */
    this.databaseName_ = options.database || 'nooblyjs';
    
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
    
    /** @private @type {MongoClient|null} */
    this.client_ = null;
    
    /** @private @type {Object|null} */
    this.db_ = null;
    
    /** @private @const {Set<string>} */
    this.initializedContainers_ = new Set();
    
    // Initialize connection
    this.initializeConnection_();
  }

  /**
   * Initializes the MongoDB connection.
   * @private
   */
  async initializeConnection_() {
    try {
      this.client_ = new MongoClient(this.connectionString_);
      await this.client_.connect();
      this.db_ = this.client_.db(this.databaseName_);
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:connected', {
          connectionString: this.connectionString_,
          database: this.databaseName_
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'connect',
          error: error.message
        });
      }
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }
  }

  /**
   * Ensures MongoDB connection is established.
   * @private
   */
  async ensureConnection_() {
    if (!this.client_ || !this.db_) {
      await this.initializeConnection_();
    }
  }

  /**
   * Gets a MongoDB collection (container).
   * @param {string} containerName The name of the container/collection.
   * @return {Object} MongoDB collection object.
   * @private
   */
  getCollection_(containerName) {
    return this.db_.collection(containerName);
  }

  /**
   * Creates a new container (MongoDB collection) for storing JSON objects.
   * @param {string} containerName The name of the container to create.
   * @return {Promise<void>} A promise that resolves when the container is created.
   */
  async createContainer(containerName) {
    await this.ensureConnection_();
    
    try {
      // MongoDB creates collections implicitly, but we can explicitly create them if needed
      if (!this.initializedContainers_.has(containerName)) {
        const collection = this.getCollection_(containerName);
        
        // Create an index on the uuid field for better performance
        await collection.createIndex({ uuid: 1 }, { unique: true });
        
        this.initializedContainers_.add(containerName);
        
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('dataserve:createContainer', { containerName });
        }
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'createContainer',
          containerName,
          error: error.message
        });
      }
      throw new Error(`Failed to create container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Adds a JSON object to the specified container (MongoDB collection).
   * @param {string} containerName The name of the container to add the object to.
   * @param {!Object} jsonObject The JSON object to store.
   * @return {Promise<string>} A promise that resolves to the unique key for the stored object.
   */
  async add(containerName, jsonObject) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const objectKey = uuidv4();
      
      // Add uuid to the object for consistent retrieval
      const documentToInsert = {
        ...jsonObject,
        uuid: objectKey,
        _createdAt: new Date(),
        _updatedAt: new Date()
      };
      
      const result = await collection.insertOne(documentToInsert);
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:add', {
          containerName,
          objectKey,
          jsonObject: documentToInsert,
          mongoId: result.insertedId
        });
      }
      
      return objectKey;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'add',
          containerName,
          error: error.message
        });
      }
      throw new Error(`Failed to add object to container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Gets a JSON object from the specified container by UUID.
   * @param {string} containerName The name of the container to retrieve the object from.
   * @param {string} objectKey The unique UUID of the object to retrieve.
   * @return {Promise<Object|null>} A promise that resolves to the object or null if not found.
   */
  async getByUuid(containerName, objectKey) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const result = await collection.findOne({ uuid: objectKey });
      
      if (result) {
        // Remove MongoDB-specific fields from the result
        const { _id, uuid, _createdAt, _updatedAt, ...cleanObject } = result;
        
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('dataserve:getByUuid', {
            containerName,
            objectKey,
            obj: cleanObject
          });
        }
        
        return cleanObject;
      }
      
      return null;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'getByUuid',
          containerName,
          objectKey,
          error: error.message
        });
      }
      throw new Error(`Failed to retrieve object from container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Removes a JSON object from the specified container.
   * @param {string} containerName The name of the container to remove the object from.
   * @param {string} objectKey The unique key of the object to remove.
   * @return {Promise<boolean>} A promise that resolves to true if the object was removed, false otherwise.
   */
  async remove(containerName, objectKey) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const result = await collection.deleteOne({ uuid: objectKey });
      
      const removed = result.deletedCount > 0;
      
      if (removed && this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:remove', { containerName, objectKey });
      }
      
      return removed;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'remove',
          containerName,
          objectKey,
          error: error.message
        });
      }
      throw new Error(`Failed to remove object from container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Finds JSON objects in the specified container that contain the search term.
   * Uses MongoDB text search and regex matching for comprehensive searching.
   * @param {string} containerName The name of the container to search in.
   * @param {string} searchTerm The term to search for (case-insensitive).
   * @return {Promise<Array<!Object>>} A promise that resolves to an array of matching objects.
   */
  async find(containerName, searchTerm) {
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      let results = [];
      
      if (!searchTerm || searchTerm.trim() === '') {
        // If no search term, return all objects
        const cursor = await collection.find({});
        const documents = await cursor.toArray();
        
        results = documents.map(doc => {
          const { _id, uuid, _createdAt, _updatedAt, ...cleanObject } = doc;
          return cleanObject;
        });
      } else {
        // Create a regex pattern for flexible text matching
        const searchRegex = new RegExp(searchTerm, 'i');
        
        // Get all documents and perform client-side search for comprehensive matching
        const cursor = await collection.find({});
        const documents = await cursor.toArray();
        
        results = documents.filter(doc => {
          // Remove MongoDB-specific fields
          const { _id, uuid, _createdAt, _updatedAt, ...cleanObject } = doc;
          
          // Recursive search function similar to in-memory implementation
          const searchInObject = (obj) => {
            for (const prop in obj) {
              if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                const value = obj[prop];
                if (typeof value === 'string') {
                  if (searchRegex.test(value)) {
                    return true;
                  }
                } else if (typeof value === 'object' && value !== null) {
                  if (searchInObject(value)) {
                    return true;
                  }
                }
              }
            }
            return false;
          };
          
          return searchInObject(cleanObject);
        }).map(doc => {
          const { _id, uuid, _createdAt, _updatedAt, ...cleanObject } = doc;
          return cleanObject;
        });
      }
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:find', {
          containerName,
          searchTerm,
          results
        });
      }
      
      return results;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'find',
          containerName,
          searchTerm,
          error: error.message
        });
      }
      throw new Error(`Failed to search in container '${containerName}': ${error.message}`);
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
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const count = await collection.countDocuments();
      
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:count', { containerName, count });
      }
      
      return count;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'count',
          containerName,
          error: error.message
        });
      }
      throw new Error(`Failed to count objects in container '${containerName}': ${error.message}`);
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
    await this.ensureConnection_();
    
    try {
      const collection = this.getCollection_(containerName);
      const updateDoc = {
        ...jsonObject,
        uuid: objectKey,
        _updatedAt: new Date()
      };
      
      const result = await collection.updateOne(
        { uuid: objectKey },
        { $set: updateDoc }
      );
      
      const updated = result.modifiedCount > 0;
      
      if (updated && this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:update', {
          containerName,
          objectKey,
          jsonObject: updateDoc
        });
      }
      
      return updated;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('dataserve:mongodb:error', {
          operation: 'update',
          containerName,
          objectKey,
          error: error.message
        });
      }
      throw new Error(`Failed to update object in container '${containerName}': ${error.message}`);
    }
  }

  /**
   * Closes the MongoDB connection.
   * @return {Promise<void>} A promise that resolves when the connection is closed.
   */
  async close() {
    if (this.client_) {
      try {
        await this.client_.close();
        this.client_ = null;
        this.db_ = null;
        
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('dataserve:mongodb:disconnected');
        }
      } catch (error) {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('dataserve:mongodb:error', {
            operation: 'close',
            error: error.message
          });
        }
        throw error;
      }
    }
  }

  /**
   * Gets the connection status.
   * @return {boolean} True if connected, false otherwise.
   */
  get status() {
    return this.client_ && this.db_ ? 'connected' : 'disconnected';
  }
}

module.exports = MongoDBDataServeProvider;