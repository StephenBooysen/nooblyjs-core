/**
 * @fileoverview Provides a singleton worker thread for executing tasks
 * with lifecycle management, status tracking, and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

/**
 * A class that manages a single worker thread for executing tasks.
 * Provides methods for starting, stopping, and monitoring worker status.
 * @class
 */
class WorkerProvider {
  /**
   * Initializes the WorkerProvider with worker thread management.
   * @param {Object=} options Configuration options for the worker.
   * @param {EventEmitter=} eventEmitter Optional event emitter for worker events.
   */
  constructor(options, eventEmitter) {
    /** @private {?Worker} */
    this.worker_ = null;
    /** @private {string} */
    this.status_ = 'idle';
    /** @private {?Function} */
    this.completionCallback_ = null;
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Starts the worker thread and executes the provided script.
   * @param {string} scriptPath The absolute path to the script to execute in the worker.
   * @param {Object} data The data to be passed to the worker thread.
   * @param {Function=} completionCallback Optional callback function to be called on completion.
   * @return {Promise<void>} A promise that resolves when the worker is started.
   * @throws {Error} When a worker is already running.
   */
  async start(scriptPath, data, completionCallback) {
    if (this.worker_) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('worker:start:error', {
          scriptPath,
          error: 'Worker already running.',
        });
      return;
    }
    this.completionCallback_ = completionCallback;

    this.worker_ = new Worker(path.resolve(__dirname, './workerScript.js'));

    if (this.eventEmitter_)
      this.eventEmitter_.emit('worker:start', { scriptPath , data });

    this.worker_.on('message', (message) => {
      if (message.type === 'status') {
        this.status_ = message.status;
        if (this.eventEmitter_)
          this.eventEmitter_.emit('worker:status', {
            status: this.status_,
            data: message.data,
          });
        if (this.status_ === 'completed' || this.status_ === 'error') {
          if (this.completionCallback_) {
            this.completionCallback_(this.status_, message.data);
          }
          this.stop(); // Automatically stop worker after completion or error
        }
      } else if (message.type === 'currentStatus') {
        // This is a response to a getStatus call, not handled here directly
      }
    });

    this.worker_.on('error', (err) => {
      this.status_ = 'error';
      console.error('Worker error:', err);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('worker:error', { error: err.message });
      if (this.completionCallback_) {
        this.completionCallback_(this.status_, err.message);
      }
      this.stop();
    });

    this.worker_.on('exit', (code) => {
      if (code !== 0 && this.status_ !== 'error') {
        this.status_ = 'error';
        console.error(`Worker stopped with exit code ${code}`);
        if (this.eventEmitter_)
          this.eventEmitter_.emit('worker:exit:error', { code });
        if (this.completionCallback_) {
          this.completionCallback_(
            this.status_, 
            `Worker exited with code ${code}`,
          );
        }
      }
      if (this.eventEmitter_) this.eventEmitter_.emit('worker:exit', { code });
      this.worker_ = null;
    });

    // send the data to the worker
    //this.worker_.postMessage(data);
    this.worker_.postMessage({
      type: 'start',
      scriptPath: scriptPath,
      data: data,
    });
  }

  /**
   * Stops the worker thread and resets the status.
   * @return {Promise<void>} A promise that resolves when the worker is stopped.
   */
  async stop() {
    if (this.worker_) {
      this.worker_.terminate();
      this.worker_ = null;
      this.status_ = 'idle';
      if (this.eventEmitter_) this.eventEmitter_.emit('worker:stop');
    }
  }

  /**
   * Gets the current status of the worker.
   * @return {Promise<string>} A promise that resolves to the current status of the worker.
   */
  async getStatus() {
    return this.status_;
  }
}

module.exports = WorkerProvider;
