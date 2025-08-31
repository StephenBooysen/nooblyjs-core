/**
 * @fileoverview DataServe Service Factory
 * Factory module for creating data service instances with multiple provider support.
 * Supports in-memory, file-based, and SimpleDB backends with routing and views.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const InMemoryDataServeProvider = require('./providers/dataserve');
const FileDataRingProvider = require('./providers/dataservefiles');
const SimpleDbDataRingProvider = require('./providers/dataserveSimpleDB');
const MongoDBDataServeProvider = require('./providers/dataserveMongoDB');
const DocumentDBDataServeProvider = require('./providers/dataserveDocumentDB');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Helper function to get nested values from objects using dot notation
 * @param {Object} obj - The object to search in
 * @param {string} path - The path to the value (e.g., 'user.profile.name')
 * @return {*} The value at the specified path
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * Creates a data service instance with the specified provider.
 * Automatically configures routes and views for the data service.
 * @param {string} type - The data provider type ('memory', 'file', 'simpledb', 'mongodb', 'documentdb')
 * @param {Object} options - Provider-specific configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {Object} Data service wrapper with provider and methods
 */
function createDataserveService(type, options, eventEmitter) {
  let provider;

  // Create data service instance based on provider type
  switch (type) {
    case 'file':
      provider = new FileDataRingProvider(options, eventEmitter);
      break;
    case 'simpledb':
      provider = new SimpleDbDataRingProvider(options, eventEmitter);
      break;
    case 'mongodb':
      provider = new MongoDBDataServeProvider(options, eventEmitter);
      break;
    case 'documentdb':
      provider = new DocumentDBDataServeProvider(options, eventEmitter);
      break;
    case 'memory':
    default:
      provider = new InMemoryDataServeProvider(options, eventEmitter);
      break;
  }

  // Remove legacy container creation - containers are created on demand

  // Create service object
  const service = {
    provider: provider,
    createContainer: (...args) => provider.createContainer(...args),
    add: (...args) => provider.add(...args),
    remove: (...args) => provider.remove(...args),
    find: (...args) => provider.find(...args),
    
    // UUID-based retrieval for API routes
    getByUuid: async (containerName, uuid) => {
      try {
        return await provider.getByUuid(containerName, uuid);
      } catch (err) {
        return null;
      }
    },

    // JSON search functionality
    jsonFind: async (containerName, predicate) => {
      try {
        // Get all objects from the container
        const allObjects = await provider.find(containerName, '');
        
        // Apply the predicate function to find matching objects
        const results = allObjects.filter(predicate);
        
        return results;
      } catch (err) {
        throw new Error(`JSON search failed: ${err.message}`);
      }
    },

    // JSON search with path-based queries (e.g., find by specific property)
    jsonFindByPath: async (containerName, path, value) => {
      try {
        // Get all objects from the container
        const allObjects = await provider.find(containerName, '');
        
        // Search for objects where the specified path matches the value
        const results = allObjects.filter(obj => {
          try {
            const pathValue = getNestedValue(obj, path);
            return pathValue === value;
          } catch {
            return false;
          }
        });
        
        return results;
      } catch (err) {
        throw new Error(`JSON path search failed: ${err.message}`);
      }
    },

    // JSON search with multiple criteria
    jsonFindByCriteria: async (containerName, criteria) => {
      try {
        // Get all objects from the container
        const allObjects = await provider.find(containerName, '');
        
        // Search for objects that match all criteria
        const results = allObjects.filter(obj => {
          return Object.entries(criteria).every(([path, expectedValue]) => {
            try {
              const actualValue = getNestedValue(obj, path);
              return actualValue === expectedValue;
            } catch {
              return false;
            }
          });
        });
        
        return results;
      } catch (err) {
        throw new Error(`JSON criteria search failed: ${err.message}`);
      }
    }
  };
  
  // Initialize routes and views for the data service with the complete service object
  Routes(options, eventEmitter, service);
  Views(options, eventEmitter, service);
  
  return service;
}

module.exports = createDataserveService;
