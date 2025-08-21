/**
 * @fileoverview Queue Service Factory
 * Factory module for creating queue service instances.
 * Provides message queuing, task scheduling, and job management capabilities.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const InMemoryQueue = require('./providers/InMemoryQueue');
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates a queue service instance with the specified provider.
 * Automatically configures routes and views for the queue service.
 * @param {string} type - The queue provider type (currently only 'memory' is supported)
 * @param {Object} options - Configuration options for the queue service
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {InMemoryQueue} Queue service instance with specified provider
 * @throws {Error} When unsupported queue type is provided
 */
function createQueue(type, options, eventEmitter) {
  let queue;
  
  // Create queue instance based on provider type
  switch (type) {
    case 'memory':
      queue = new InMemoryQueue(options, eventEmitter);
      break;
    default:
      throw new Error(`Unsupported queue type: ${type}`);
  }
  
  // Initialize routes and views for the queue service
  Routes(options, eventEmitter, queue);
  Views(options, eventEmitter, queue);
  
  return queue;
}

module.exports = createQueue;
