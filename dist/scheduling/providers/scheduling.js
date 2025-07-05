"use strict";

/**
 * @fileoverview Provides a singleton scheduler for executing tasks at intervals.
 */

const getWorkerInstance = require('../../working/');

/**
 * Manages scheduling and execution of tasks in a worker thread.
 */
class SchedulerProvider {
  /**
   * Initializes the SchedulerProvider.
   */
  constructor(options, eventEmitter) {
    /** @private {?NodeJS.Timeout} */
    this.intervalId_ = null;
    /** @private {string} */
    this.scriptPath_ = '';
    /** @private {Function} */
    this.executionCallback_ = null;
    this.eventEmitter_ = eventEmitter;
    /** @private {WorkerProvider} */
    this.worker_ = getWorkerInstance('memory', options, this.eventEmitter_);
  }

  /**
   * Starts the scheduler to execute a script at a given interval.
   * @param {string} scriptPath The absolute path to the Node.js file to execute.
   * @param {number} intervalSeconds The interval in seconds at which to execute the script.
   * @param {Function=} executionCallback Optional callback function to be called on each execution.
   */
  async start(scriptPath, intervalSeconds, executionCallback) {
    if (this.intervalId_) {
      if (this.eventEmitter_) this.eventEmitter_.emit('scheduler:start:error', {
        scriptPath,
        error: 'Scheduler already running.'
      });
      return;
    }
    this.scriptPath_ = scriptPath;
    this.executionCallback_ = executionCallback;
    const executeTask = () => {
      this.worker_.start(this.scriptPath_, null, (status, data) => {
        if (this.executionCallback_) {
          this.executionCallback_(status, data);
        }
        if (this.eventEmitter_) this.eventEmitter_.emit('scheduler:taskExecuted', {
          scriptPath,
          status,
          data
        });
      });
    };

    // Execute immediately and then at intervals
    executeTask();
    this.intervalId_ = setInterval(executeTask, intervalSeconds * 1000);
    if (this.eventEmitter_) this.eventEmitter_.emit('scheduler:started', {
      scriptPath,
      intervalSeconds
    });
  }

  /**
   * Stops the scheduler.
   */
  async stop() {
    if (this.intervalId_) {
      clearInterval(this.intervalId_);
      this.intervalId_ = null;
      this.scriptPath_ = '';
      this.executionCallback_ = null;
      this.worker_.stop(); // Ensure the worker is stopped
      if (this.eventEmitter_) this.eventEmitter_.emit('scheduler:stopped');
    }
  }

  /**
   * Checks if the scheduler is running.
   * @return {boolean} True if the scheduler is running, false otherwise.
   */
  async isRunning() {
    return this.intervalId_ !== null;
  }
}
module.exports = SchedulerProvider;