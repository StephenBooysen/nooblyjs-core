/**
 * @fileoverview MongoDB DataService provider for storing and searching JSON objects
 * with container-based organization using MongoDB collections and event emission support.
 * @author NooblyJS Team
 * @version 1.0.15
 * @since 1.0.0
 */

'use strict';

const { loadOptionalModule } = require('../../shared/utils/optionalRequire');

/** @return {{MongoClient: Function}} The mongodb driver, loaded on first use */
const mongodb = () => loadOptionalModule('mongodb', 'MongoDB dataservice');
const MongoBaseProvider = require('./MongoBaseProvider');
const outbox = require('../modules/outbox');

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
      const { MongoClient } = mongodb();
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

  /**
   * Writes an event and its record in one transaction when the server supports
   * transactions (a replica set or sharded cluster), so both exist or neither
   * does. On a standalone server it falls back to the ordered writes of the
   * outbox, which the relay repairs. See modules/outbox.js (feature 12).
   *
   * @param {string} containerName Container for the record
   * @param {Object} record Record to store
   * @param {{name: string, payload?: *}} event Event to publish later
   * @return {Promise<{key: string, eventId: string}>}
   */
  async addWithEvent(containerName, record, event) {
    await this.ensureConnection_();
    if (this.transactions_ === false) return outbox.addWithEvent(this, containerName, record, event);
    const eventId = require('node:crypto').randomUUID();
    const recordKey = require('node:crypto').randomUUID();
    const entry = {
      id: eventId,
      container: containerName,
      recordKey,
      record: structuredClone(record),
      event: { name: event.name, payload: event.payload === undefined ? null : structuredClone(event.payload) },
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString()
    };
    const session = this.client_.startSession();
    try {
      await session.withTransaction(async () => {
        await this.getCollection_(outbox.OUTBOX_CONTAINER).insertOne(this.keyedDocument_(eventId, entry), { session });
        await this.getCollection_(containerName).insertOne(this.keyedDocument_(recordKey, record), { session });
      });
      this.transactions_ = true;
      return { key: recordKey, eventId };
    } catch (error) {
      // Standalone servers refuse transactions: remember that and use the ordered path.
      if (error && (error.code === 20 || /Transaction numbers|replica set/i.test(error.message || ''))) {
        this.transactions_ = false;
        return outbox.addWithEvent(this, containerName, record, event);
      }
      throw error;
    } finally {
      await session.endSession().catch(() => {});
    }
  }

  /**
   * Relays pending outbox entries. See outbox.relayOutbox.
   * @param {Function} publish
   * @param {Object=} options
   * @return {Promise<{published: number, failed: number}>}
   */
  async relayOutbox(publish, options) {
    return outbox.relayOutbox(this, publish, options);
  }
}

module.exports = MongoDBDataServiceProvider;
