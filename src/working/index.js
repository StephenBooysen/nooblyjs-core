/**
 * @fileoverview Singleton factory for the WorkerProvider.
 */

const WorkerProvider = require('./providers/workerProvider');

/** @type {WorkerProvider} */
let instance = null;

/**
 * Returns the singleton instance of the WorkerProvider.
 * @return {!WorkerProvider} The singleton WorkerProvider instance.
 */
function getWorkerInstance(eventEmitter) {
  if (!instance) {
    instance = new WorkerProvider(eventEmitter);
  }
  return instance;
}

module.exports = getWorkerInstance;
