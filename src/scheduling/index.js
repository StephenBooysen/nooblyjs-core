/**
 * @fileoverview Singleton factory for the SchedulerProvider.
 */

const SchedulerProvider = require('./providers/schedulerProvider');

/** @type {SchedulerProvider} */
let instance = null;

/**
 * Returns the singleton instance of the SchedulerProvider.
 * @return {!SchedulerProvider} The singleton SchedulerProvider instance.
 */
function getSchedulerInstance(eventEmitter) {
  if (!instance) {
    instance = new SchedulerProvider(eventEmitter);
  }
  return instance;
}

module.exports = getSchedulerInstance;
