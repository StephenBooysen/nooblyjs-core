/**
 * @fileoverview DocumentDB DataService provider for storing and searching JSON objects
 * with container-based organization using DocumentDB collections and event emission support.
 * Compatible with MongoDB-compatible DocumentDB implementations.
 * @author NooblyJS Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const { MongoClient } = requireOptional('mongodb', "dataService('documentdb')");
const MongoBaseProvider = require('./MongoBaseProvider');

/**
 * A class that implements a DocumentDB data storage provider.
 * Extends MongoBaseProvider for shared functionality.
 * @class
 */
class DocumentDBDataServiceProvider extends MongoBaseProvider {
  /**
   * Initializes the DocumentDB data storage provider.
   * @param {Object=} options Configuration options for DocumentDB connection.
   * @param {string=} options.host DocumentDB host (defaults to '127.0.0.1').
   * @param {number=} options.port DocumentDB port (defaults to 10260).
   * @param {string=} options.database Database name to use (defaults to nooblyjs).
   * @param {string=} options.username Username for authentication (optional).
   * @param {string=} options.password Password for authentication (optional).
   * @param {boolean=} options.ssl Enable SSL connection (defaults to false for local development).
   * @param {string=} options.connectionString Full connection string (overrides individual options).
   * @param {EventEmitter=} eventEmitter Optional event emitter for data operations.
   */
  constructor(options = {}, eventEmitter) {
    super('documentdb', options, eventEmitter);
    
    /** @private @const {string} */
    this.host_ = options.host || '127.0.0.1';
    
    /** @private @const {number} */
    this.port_ = options.port || 10260;
    
    /** @private @const {string} */
    this.databaseName_ = options.database || 'nooblyjs';
    
    /** @private @const {string} */
    this.username_ = options.username || '';
    
    /** @private @const {string} */
    this.password_ = options.password || '';
    
    /** @private @const {boolean} */
    this.ssl_ = options.ssl || false;
    
    /** @private @const {string} */
    this.connectionString_ = this.buildConnectionString_(options);
    
    // Connect eagerly, but don't let a failed startup connection become an
    // unhandled rejection: the failure is emitted as an error event and
    // ensureConnection_() retries on the next operation.
    this.initializeConnection_().catch(() => {});
  }

  /**
   * Builds the DocumentDB connection string from options.
   * @param {Object} options Configuration options.
   * @return {string} DocumentDB connection string.
   * @private
   */
  buildConnectionString_(options) {
    if (options.connectionString) {
      return options.connectionString;
    }
    
    let connectionString = 'mongodb://';
    if (this.username_ && this.password_) {
      connectionString += `${encodeURIComponent(this.username_)}:${encodeURIComponent(this.password_)}@`;
    }
    connectionString += `${this.host_}:${this.port_}/${this.databaseName_}`;
    
    const queryParams = [];
    if (this.ssl_) queryParams.push('ssl=true');
    queryParams.push('retryWrites=false');
    
    if (queryParams.length > 0) {
      connectionString += '?' + queryParams.join('&');
    }
    
    return connectionString;
  }

  /**
   * Initializes the DocumentDB connection.
   * @private
   */
  async initializeConnection_() {
    try {
      const clientOptions = {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        retryWrites: false,
        readPreference: 'primary'
      };
      
      this.client_ = new MongoClient(this.connectionString_, clientOptions);
      await this.client_.connect();
      this.db_ = this.client_.db(this.databaseName_);
      
      this.emitEvent_('connected', {
        host: this.host_,
        port: this.port_,
        database: this.databaseName_,
        ssl: this.ssl_
      });
    } catch (error) {
      this.emitEvent_('error', {
        operation: 'connect',
        error: error.message
      });
      throw new Error(`DocumentDB connection failed: ${error.message}`);
    }
  }

  /**
   * Creates a new container (DocumentDB collection).
   */
  async createContainer(containerName) {
    await this.ensureConnection_();
    
    try {
      if (!this.initializedContainers_.has(containerName)) {
        const collection = this.getCollection_(containerName);
        
        try {
          await collection.createIndex({ uuid: 1 }, { unique: true });
        } catch (indexError) {
          this.logger?.warn(`[${this.constructor.name}] DocumentDB index fallback`, {
            containerName,
            error: indexError.message
          });
          await collection.createIndex({ uuid: 1 });
        }
        
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

  /**
   * Gets connection information.
   */
  getConnectionInfo() {
    return {
      host: this.host_,
      port: this.port_,
      database: this.databaseName_,
      ssl: this.ssl_,
      status: this.status
    };
  }
}

module.exports = DocumentDBDataServiceProvider;
