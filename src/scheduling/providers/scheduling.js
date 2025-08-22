/**
 * @fileoverview Provides a singleton scheduler for executing tasks at intervals
 * using worker threads with task management and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const getWorkerInstance = require('../../working/');

/**
 * A class that manages scheduling and execution of tasks in worker threads.
 * Provides methods for starting, stopping, and monitoring scheduled tasks.
 * @class
 */
class SchedulerProvider {
  /**
   * Initializes the SchedulerProvider with task storage and worker instance.
   * @param {Object=} options Configuration options for the scheduler.
   * @param {EventEmitter=} eventEmitter Optional event emitter for scheduler events.
   */
  constructor(options, eventEmitter) {
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
    /** @private @const {!Map<string, !Object>} */
    this.tasks_ = new Map();
    /** @private @const {WorkerProvider} */
    this.worker_ = getWorkerInstance('memory', options, this.eventEmitter_);
  }

  /**
   * Starts the scheduler to execute a script at a given interval.
   * @param {string} taskName The name of the task to schedule.
   * @param {string} scriptPath The absolute path to the Node.js file to execute.
   * @param {*|number} dataOrInterval The data to pass to the script, or interval if 3 args provided.
   * @param {number=} intervalSeconds The interval in seconds at which to execute the script.
   * @param {Function=} executionCallback Optional callback function to be called on each execution.
   * @return {Promise<void>} A promise that resolves when the task is started.
   * @throws {Error} When a task with the same name is already scheduled.
   */
  async start(taskName, scriptPath, dataOrInterval, intervalSeconds, executionCallback) {
    // Handle different calling patterns for backward compatibility
    let data, interval, callback;
    
    if (arguments.length === 3) {
      // start(taskName, scriptPath, intervalSeconds)
      data = null;
      interval = dataOrInterval;
      callback = undefined;
    } else if (arguments.length === 4) {
      // start(taskName, scriptPath, intervalSeconds, executionCallback)
      data = null;
      interval = dataOrInterval;
      callback = intervalSeconds;
    } else {
      // start(taskName, scriptPath, data, intervalSeconds, executionCallback)
      data = dataOrInterval;
      interval = intervalSeconds;
      callback = executionCallback;
    }
    if (this.tasks_.has(taskName)) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('scheduler:start:error', {
          taskName,
          error: 'Task already scheduled.',
        });
      return;
    }

    const executeTask = () => {
      this.worker_.start(scriptPath, data, (status, data) => {
        if (callback) {
          callback(status, data);
        }
        if (this.eventEmitter_)
          this.eventEmitter_.emit('scheduler:taskExecuted', {
            taskName,
            scriptPath,
            status,
            data,
          });
      });
    };

    // Execute immediately and then at intervals
    executeTask();
    const intervalId = setInterval(executeTask, interval * 1000);
    this.tasks_.set(taskName, {
      intervalId,
      scriptPath,
      executionCallback: callback,
    });

    if (this.eventEmitter_)
      this.eventEmitter_.emit('scheduler:started', {
        taskName,
        scriptPath,
        intervalSeconds: interval,
      });
  }

  /**
   * Stops a specific task or all tasks if no task name is provided.
   * @param {string=} taskName The name of the task to stop (optional).
   * @return {Promise<void>} A promise that resolves when the task(s) are stopped.
   */
  async stop(taskName) {
    if (taskName) {
      if (this.tasks_.has(taskName)) {
        const task = this.tasks_.get(taskName);
        clearInterval(task.intervalId);
        this.tasks_.delete(taskName);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('scheduler:stopped', { taskName });
      }
    } else {
      this.tasks_.forEach((task, name) => {
        clearInterval(task.intervalId);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('scheduler:stopped', { taskName: name });
      });
      this.tasks_.clear();
      // Stop the worker when stopping all tasks
      if (this.worker_ && this.worker_.stop) {
        this.worker_.stop();
      }
    }
  }

  /**
   * Checks if a specific task or any task is running.
   * @param {string=} taskName The name of the task to check (optional).
   * @return {Promise<boolean>} A promise that resolves to true if the task(s) are running, false otherwise.
   */
  async isRunning(taskName) {
    if (taskName) {
      return this.tasks_.has(taskName);
    }
    return this.tasks_.size > 0;
  }
}

module.exports = SchedulerProvider;
