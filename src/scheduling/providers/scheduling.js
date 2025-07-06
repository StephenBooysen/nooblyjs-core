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
    this.eventEmitter_ = eventEmitter;
    /** @private {Map<string, object>} */
    this.tasks_ = new Map();
    /** @private {WorkerProvider} */
    this.worker_ = getWorkerInstance('memory', options, this.eventEmitter_);
  }

  /**
   * Starts the scheduler to execute a script at a given interval.
   * @param {string} taskName The name of the task to schedule.
   * @param {string} scriptPath The absolute path to the Node.js file to execute.
   * @param {number} intervalSeconds The interval in seconds at which to execute the script.
   * @param {Function=} executionCallback Optional callback function to be called on each execution.
   */
  async start(taskName, scriptPath, intervalSeconds, executionCallback) {
    if (this.tasks_.has(taskName)) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('scheduler:start:error', {
          taskName,
          error: 'Task already scheduled.',
        });
      return;
    }

    const executeTask = () => {
      this.worker_.start(scriptPath, null, (status, data) => {
        if (executionCallback) {
          executionCallback(status, data);
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
    const intervalId = setInterval(executeTask, intervalSeconds * 1000);
    this.tasks_.set(taskName, {
      intervalId,
      scriptPath,
      executionCallback,
    });

    if (this.eventEmitter_)
      this.eventEmitter_.emit('scheduler:started', {
        taskName,
        scriptPath,
        intervalSeconds,
      });
  }

  /**
   * Stops a specific task or all tasks if no task name is provided.
   * @param {string=} taskName The name of the task to stop.
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
    }
    if (this.tasks_.size === 0) {
      this.worker_.stop();
    }
  }

  /**
   * Checks if a specific task or any task is running.
   * @param {string=} taskName The name of the task to check.
   * @return {boolean} True if the task(s) are running, false otherwise.
   */
  async isRunning(taskName) {
    if (taskName) {
      return this.tasks_.has(taskName);
    }
    return this.tasks_.size > 0;
  }
}

module.exports = SchedulerProvider;
