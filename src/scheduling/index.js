/**
 * @fileoverview Singleton factory for the SchedulerProvider.
 */

const SchedulerProvider = require('./providers/schedulingProvider');

/** @type {SchedulerProvider} */
let instance = null;

/**
 * Returns the singleton instance of the SchedulerProvider.
 * @return {!SchedulerProvider} The singleton SchedulerProvider instance.
 */
function getSchedulerInstance(type, options, eventEmitter) {
  if (!instance) {
    instance = new SchedulerProvider(options, eventEmitter);
  }
  return instance;
}

/**
 * Resets the singleton instance for testing purposes.
 */
function resetSchedulerInstance() {
  instance = null;
}

module.exports = getSchedulerInstance;
module.exports.reset = resetSchedulerInstance;
