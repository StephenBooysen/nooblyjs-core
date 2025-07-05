/**
 * @fileoverview Provides a singleton worker thread for executing tasks.
 */

const { Worker } = require('worker_threads');
const path = require('path');

/**
 * Manages a single worker thread for executing tasks.
 */
class WorkerProvider {
  /**
   * Initializes the WorkerProvider.
   */
  constructor(options, eventEmitter) {
    /** @private {Worker} */
    this.worker_ = null;
    /** @private {string} */
    this.status_ = 'idle';
    /** @private {Function} */
    this.completionCallback_ = null;
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Starts the worker thread and executes the provided script.
   * @param {string} scriptPath The absolute path to the script to execute in the worker.
   * @param {Object} data The data to be passed to the worker thread.
   * @param {Function=} completionCallback Optional callback function to be called on completion.
   */
  async start(scriptPath, data,  completionCallback) {
    
    if (this.worker_) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('worker:start:error', {
          scriptPath,
          error: 'Worker already running.',
        });
      return;
    }
    this.completionCallback_ = completionCallback;

    this.worker_ = new Worker(
      path.resolve(__dirname, './workerScript.js')
    );

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

    this.worker_.postMessage({ type: 'start', scriptPath: scriptPath });
  }

  /**
   * Stops the worker thread.
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
   * @return {string} The current status of the worker.
   */
  async getStatus() {
    return this.status_;
  }
}

module.exports = WorkerProvider;
