/**
 * @fileoverview NooblyJS Core - Worker/Activity Base Class
 * Base class for implementing background workers and activities in NooblyJS Core.
 * Provides integration with the working service for asynchronous task execution.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const appBase = require('./appBase.js');

/**
 * Base class for custom background workers and activities.
 * Extends appBase to provide worker-specific functionality for asynchronous task execution.
 * Use this when implementing background jobs, scheduled tasks, or long-running activities.
 *
 * Activities are executed by the working service and can be part of workflows or scheduled tasks.
 * Each activity should implement a `run()` async method that accepts data and returns results.
 *
 * @class appWorkerBase
 * @extends {appBase}
 */
class appWorkerBase extends appBase {

  /**
   * Creates a new appWorkerBase instance.
   *
   * @param {string} type - The worker/activity type identifier (e.g., 'process-order', 'send-email')
   * @param {Object} options - Worker configuration options
   * @param {Express} options['express-app'] - Express application instance
   * @param {Object} [options.dependencies] - Injected service dependencies (logging, dataservice, etc.)
   * @param {Object} [options.activityConfig] - Activity-specific configuration
   * @param {number} [options.timeout=300000] - Timeout for activity execution in milliseconds
   * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
   * @param {string} [options.instanceName='default'] - Unique identifier for this worker instance
   * @param {EventEmitter} eventEmitter - Global event emitter for worker communication
   *
   * @example
   * // Creating a custom activity that extends appWorkerBase
   * class ProcessOrderActivity extends appWorkerBase {
   *   constructor(type, options, eventEmitter) {
   *     super(type, options, eventEmitter);
   *   }
   *
   *   // This method is called by the working service
   *   async run(data) {
   *     const { orderId, items } = data;
   *
   *     // Perform order processing
   *     const total = await this.calculateTotal(items);
   *     const orderRecord = await this.createOrder(orderId, items, total);
   *
   *     return {
   *       success: true,
   *       orderId: orderRecord.id,
   *       total: total
   *     };
   *   }
   *
   *   async calculateTotal(items) {
   *     return items.reduce((sum, item) => sum + item.price, 0);
   *   }
   *
   *   async createOrder(orderId, items, total) {
   *     // Save to database via injected dependencies
   *     return { id: orderId, items, total };
   *   }
   * }
   *
   * @example
   * // Using the activity in a workflow
   * const orderActivity = new ProcessOrderActivity('order-processor', {
   *   'express-app': app,
   *   dependencies: { logging, dataservice },
   *   timeout: 60000 // 1 minute timeout
   * }, eventEmitter);
   *
   * // The activity can be used in workflows or scheduled tasks
   * await workflowService.defineWorkflow('checkout', [orderActivity]);
   */
  constructor(type, options, eventEmitter) {
    super(type, options, eventEmitter);

    /**
     * Activity-specific configuration
     * @type {Object}
     * @protected
     */
    this.activityConfig = options.activityConfig || {};

    /**
     * Timeout for activity execution in milliseconds
     * @type {number}
     * @protected
     */
    this.timeout = options.timeout || 300000;

    /**
     * Maximum number of retry attempts on failure
     * @type {number}
     * @protected
     */
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Executes the worker/activity with the provided data.
   * This method should be overridden by subclasses to implement specific activity logic.
   *
   * @param {Object} data - Input data for the activity
   * @return {Promise<Object>} Result object containing activity output
   * @throws {Error} When activity execution fails
   * @abstract
   *
   * @example
   * async run(data) {
   *   // Implement your activity logic here
   *   return { success: true, result: data };
   * }
   */
  async run(data) {
    throw new Error('Activity run() method must be implemented in subclass');
  }
}

module.exports = appWorkerBase;