/**
 * @fileoverview Working Service Factory
 * Singleton factory module for creating worker service instances.
 * Provides background task execution, worker thread management, and job processing.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// TODO - we need to work on how data is passed to the script

const WorkerProvider = require('./providers/working');
const Routes = require('./routes');
const Views = require('./views');

/** @type {WorkerProvider} */
let instance = null;

/**
 * Returns the singleton instance of the worker service.
 * Automatically configures routes and views for the working service.
 * @param {string} type - The worker service type
 * @param {Object} options - Configuration options for the worker service
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {WorkerProvider} The singleton worker service instance
 */
function getWorkerInstance(type, options, eventEmitter) {
  // Create singleton instance if it doesn't exist
  if (!instance) {
    instance = new WorkerProvider(options, eventEmitter);

    // Initialize routes and views for the working service
    Routes(options, eventEmitter, instance);
    Views(options, eventEmitter, instance);
  }

  return instance;
}

module.exports = getWorkerInstance;
