/**
 * @fileoverview Singleton factory for the WorkerProvider.
 */

const WorkerProvider = require('./providers/workingProvider');

/** @type {WorkerProvider} */
let instance = null;

/**
 * Returns the singleton instance of the WorkerProvider.
 * @return {!WorkerProvider} The singleton WorkerProvider instance.
 */
function getWorkerInstance(type, options, eventEmitter) {
  if (!instance) {
    instance = new WorkerProvider(options, eventEmitter);
  }
  return instance;
}

module.exports = getWorkerInstance;
