/**
 * @fileoverview Singleton factory for the WorkerProvider.
 */
// TODO - we need to work on how data is passed to the script

const WorkerProvider = require('./providers/workingProvider');
const Routes = require('./routes');

/** @type {WorkerProvider} */
let instance = null;

/**
 * Creates a queue instance based on the provided type.
 * @param {string} type The type of queue to create. Valid options are 'memory'.
 * @param {Object} options The options for the queue.
 * @param {EventEmitter} eventEmitter The eventEmitter for the queue.
 * @return {Object} A worker instance.
 */
function getWorkerInstance(type, options, eventEmitter) {
  if (!instance) {
    instance = new WorkerProvider(options, eventEmitter);
    Routes(options, eventEmitter, instance);
  }
  return instance;
}

module.exports = getWorkerInstance;
