/**
 * @fileoverview MongoDB DataService provider for storing and searching JSON objects
 * with container-based organization using MongoDB collections and event emission support.
 * @author NooblyJS Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const { MongoClient } = requireOptional('mongodb', "dataService('mongodb')");
const MongoBaseProvider = require('./MongoBaseProvider');

/**
 * A class that implements a MongoDB data storage provider.
 * Extends MongoBaseProvider for shared functionality.
 * @class
 */
class MongoDBDataServiceProvider extends MongoBaseProvider {
  /**
   * Initializes the MongoDB data storage provider.
   * @param {Object=} options Configuration options for MongoDB connection.
   * @param {string=} options.connectionString MongoDB connection string (defaults to local MongoDB).
   * @param {string=} options.database Database name to use (defaults to nooblyjs).
   * @param {EventEmitter=} eventEmitter Optional event emitter for data operations.
   */
  constructor(options = {}, eventEmitter) {
    super('mongodb', options, eventEmitter);
    
    /** @private @const {string} */
    this.connectionString_ = options.connectionString || 'mongodb://127.0.0.1:27017';
    
    /** @private @const {string} */
    this.databaseName_ = options.database || 'nooblyjs';
    
    // Connect eagerly, but don't let a failed startup connection become an
    // unhandled rejection: the failure is emitted as an error event and
    // ensureConnection_() retries on the next operation.
    this.initializeConnection_().catch(() => {});
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
      
      this.emitEvent_('connected', {
        connectionString: this.connectionString_,
        database: this.databaseName_
      });
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'connect',
        error: error.message
      });
      throw new Error(`MongoDB connection failed: ${error.message}`);
    }
  }

  /**
   * Creates a new container (MongoDB collection) for storing JSON objects.
   * @param {string} containerName The name of the container to create.
   * @return {Promise<void>} A promise that resolves when the container is created.
   */
  async createContainer(containerName) {
    await this.ensureConnection_();
    
    try {
      if (!this.initializedContainers_.has(containerName)) {
        const collection = this.getCollection_(containerName);
        
        // Create an index on the uuid field for better performance
        await collection.createIndex({ uuid: 1 }, { unique: true });
        
        this.initializedContainers_.add(containerName);
        this.emitEvent_('createContainer', { containerName });
      }
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'createContainer',
        containerName,
        error: error.message
      });
      throw new Error(`Failed to create container '${containerName}': ${error.message}`);
    }
  }
}

module.exports = MongoDBDataServiceProvider;
