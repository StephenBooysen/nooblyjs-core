/**
 * @fileoverview Singleton factory for the SchedulerProvider.
 */

const SchedulerProvider = require('./providers/scheduling');
const Routes = require('./routes');

/** @type {SchedulerProvider} */
let instance = null;

/**
 * Returns the singleton instance of the SchedulerProvider.
 * @param {string} type The type of scheduler to create (e.g., 'memory').
 * @param {Object} options Options for the scheduler.
 * @param {EventEmitter} eventEmitter The event emitter to use for events.
 * @return {!SchedulerProvider} The singleton SchedulerProvider instance.
 */
function getSchedulerInstance(type, options, eventEmitter) {
  if (!instance) {
    instance = new SchedulerProvider(options, eventEmitter);
    Routes(options, eventEmitter, instance);
  }
  return instance;
}

getSchedulerInstance._reset = () => {
  instance = null;
};

module.exports = getSchedulerInstance;
