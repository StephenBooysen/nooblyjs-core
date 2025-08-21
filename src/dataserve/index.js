/**
 * @fileoverview DataServe Service Factory
 * Factory module for creating data service instances with multiple provider support.
 * Supports in-memory, file-based, and SimpleDB backends with routing and views.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const InMemoryDataServeProvider = require('./providers/dataserve');
const FileDataRingProvider = require('./providers/dataservefiles');
const SimpleDbDataRingProvider = require('./providers/dataserveSimpleDB');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a data service instance with the specified provider.
 * Automatically configures routes and views for the data service.
 * @param {string} type - The data provider type ('memory', 'file', 'simpledb')
 * @param {Object} options - Provider-specific configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {InMemoryDataServeProvider|FileDataRingProvider|SimpleDbDataRingProvider} Data service instance with specified provider
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
    case 'memory':
    default:
      provider = new InMemoryDataServeProvider(options, eventEmitter);
      break;
  }
  
  // Initialize routes and views for the data service
  Routes(options, eventEmitter, provider);
  Views(options, eventEmitter, provider);
  
  return provider;
}

module.exports = createDataserveService;
