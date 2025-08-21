/**
 * @fileoverview Scheduling Service Factory
 * Singleton factory module for creating scheduler service instances.
 * Provides task scheduling, cron job management, and timed execution capabilities.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const SchedulerProvider = require('./providers/scheduling');
const Routes = require('./routes');
const Views = require('./views');

/** @type {SchedulerProvider} */
let instance = null;

/**
 * Returns the singleton instance of the scheduler service.
 * Automatically configures routes and views for the scheduling service.
 * @param {string} type - The scheduler service type (e.g., 'memory')
 * @param {Object} options - Configuration options for the scheduler service
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {SchedulerProvider} The singleton scheduler service instance
 */
function getSchedulerInstance(type, options, eventEmitter) {
  // Create singleton instance if it doesn't exist
  if (!instance) {
    instance = new SchedulerProvider(options, eventEmitter);
    
    // Initialize routes and views for the scheduling service
    Routes(options, eventEmitter, instance);
    Views(options, eventEmitter, instance);
  }
  
  return instance;
}

/**
 * Resets the singleton instance for testing purposes.
 * @private
 */
getSchedulerInstance._reset = () => {
  instance = null;
};

module.exports = getSchedulerInstance;
