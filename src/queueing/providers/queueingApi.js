/**
 * @fileoverview API-based queueing service implementation that proxies requests to a remote queueing service.
 * Allows client applications to consume backend queueing API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements queue operations via HTTP API calls to a remote service.
 * Provides methods for enqueuing, dequeuing, and managing queues through REST endpoints.
 * @class
 */
class QueueingApi {
  /**
   * Initializes the Queueing API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 10000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for queueing events.
   */
  constructor(options = {}, eventEmitter) {
      this.settings = {};
      this.settings.description = "The distributed queueing module requires api connections";
      this.settings.list = [
        {setting: "url", type: "string", values : ['e.g. http://queueing.com']},
        {setting: "apikey", type: "string", values : ['Please speak to your admin for this key']}
      ];
      this.settings.url = options.api || 'http://localhost:3000';
      this.settings.apikey = options.apiKey || null;
      this.timeout = options.timeout || 5000;

      this.eventEmitter_ = eventEmitter;
      this.instanceName_ = (options && options.instanceName) || 'default';

      // Configure axios instance
      this.client = axios.create({
        baseURL: this.settings.url,
        timeout: this.timeout,
        headers: this.settings.apikey ? { 'X-API-Key': this.settings.apikey } : {}
      });
  }

    /**
   * Get all our settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings){
    for (let i = 0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${this.settings.list[i].setting}`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting]
        });
      }
    }
  }

  /**
   * Adds a job to a queue via the remote queueing service.
   * Submits a job to be processed asynchronously by workers consuming the queue.
   * Jobs are stored in FIFO order and processed based on availability and priority settings.
   *
   * @param {string} queueName The name of the queue to add the job to. Queue is created if it doesn't exist.
   * @param {Object} job The job payload containing the work to be performed.
   *   - type: {string} Job type identifier
   *   - data: {*} Arbitrary data passed to the job processor
   *   - Other provider-specific fields
   * @param {Object} [options] Optional job configuration including:
   *   - priority: {number} Job priority (1-10, higher = more urgent)
   *   - delay: {number} Delay in milliseconds before job becomes available
   *   - timeout: {number} Job execution timeout in milliseconds
   *   - retries: {number} Maximum retry attempts on failure
   * @return {Promise<Object>} A promise that resolves to the enqueued job object including:
   *   - jobId: {string} Unique job identifier
   *   - queueName: {string} The queue name
   *   - status: {string} Current job status ('pending', 'processing', etc.)
   * @throws {Error} When the HTTP request fails or the queue cannot be created
   *
   * @example
   * // Enqueue a simple job
   * const job = {
   *   type: 'send-email',
   *   data: { to: 'user@example.com', subject: 'Welcome!' }
   * };
   * const result = await queueApi.enqueue('emails', job);
   * console.log(`Job queued with ID: ${result.jobId}`);
   *
   * @example
   * // Enqueue with high priority and retry configuration
   * const urgent = {
   *   type: 'alert-admin',
   *   data: { severity: 'critical', message: 'System error' }
   * };
   * const options = { priority: 10, retries: 5, timeout: 30000 };
   * await queueApi.enqueue('alerts', urgent, options);
   */
  /**
   * Validates that a queue name is a non-empty string.
   * @param {string} queueName The queue name to validate.
   * @param {string} method The calling method name for error context.
   * @throws {Error} When queue name is invalid.
   * @private
   */
  validateQueueName_(queueName, method) {
    if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
      const error = new Error('Invalid queue name: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit(`queue:validation-error:${this.instanceName_}`, {
          method,
          error: error.message,
          queueName
        });
      }
      throw error;
    }
  }

  async enqueue(queueName, task, options) {
    this.validateQueueName_(queueName, 'enqueue');
    try {
      // Feature 06: options make the remote side create a reliable job.
      const body = options && typeof options === 'object' ? { task, options } : { task };
      const response = await this.client.post(`/services/queueing/api/enqueue/${queueName}`, body);
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:enqueue:${this.instanceName_}`, { queueName, item: task });
      return body.options && response.data ? response.data.jobId : response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:error:${this.instanceName_}`, { operation: 'enqueue', queueName, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves and removes the next job from a queue via the remote queueing service.
   * Atomically dequeues a job and returns it to the caller for processing.
   * If the queue is empty, returns null or waits based on server configuration.
   *
   * @param {string} queueName The name of the queue to consume from
   * @return {Promise<Object|null>} A promise that resolves to the next job object in the queue, or null if empty
   * @throws {Error} When the HTTP request fails or the queue does not exist
   *
   * @example
   * // Dequeue and process the next job
   * const job = await queueApi.dequeue('emails');
   * if (job) {
   *   console.log(`Processing job: ${job.type}`);
   *   // Process job...
   * }
   */
  async dequeue(queueName) {
    this.validateQueueName_(queueName, 'dequeue');
    try {
      const response = await this.client.get(`/services/queueing/api/dequeue/${queueName}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:dequeue:${this.instanceName_}`, { queueName });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:error:${this.instanceName_}`, { operation: 'dequeue', queueName, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves statistics and metrics for a specific queue via the remote queueing service.
   * Returns information about queue health, size, and processing performance.
   *
   * @param {string} queueName The name of the queue to get statistics for
   * @return {Promise<Object>} A promise that resolves to the queue statistics including:
   *   - queueName: {string} The queue name
   *   - size: {number} Current number of jobs in the queue
   *   - active: {number} Number of jobs currently being processed
   *   - completed: {number} Total jobs successfully completed
   *   - failed: {number} Total jobs that failed
   *   - avgProcessingTime: {number} Average processing time in milliseconds
   * @throws {Error} When the HTTP request fails or the queue does not exist
   *
   * @example
   * // Get queue statistics for monitoring
   * const stats = await queueApi.getStats('emails');
   * console.log(`Queue size: ${stats.size} jobs`);
   * console.log(`Failed jobs: ${stats.failed}`);
   * console.log(`Avg processing time: ${stats.avgProcessingTime}ms`);
   */
  async getStats(queueName) {
    try {
      const response = await this.client.get(`/services/queueing/api/stats/${queueName}`);
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:error:${this.instanceName_}`, { operation: 'getStats', queueName, error: error.message });
      throw error;
    }
  }

  /**
   * Lists all available queues on the remote queueing service.
   * Returns metadata about all queues including their current state and configuration.
   *
   * @return {Promise<Array>} A promise that resolves to an array of queue objects, each containing:
   *   - name: {string} Queue identifier
   *   - size: {number} Current job count
   *   - active: {number} Jobs being processed
   *   - createdAt: {string} ISO timestamp when queue was created
   *   - provider: {string} Underlying queue provider (Redis, RabbitMQ, etc.)
   * @throws {Error} When the HTTP request fails
   *
   * @example
   * // List all queues and their sizes
   * const queues = await queueApi.listQueues();
   * queues.forEach(q => {
   *   console.log(`${q.name}: ${q.size} pending, ${q.active} active`);
   * });
   */
  async listQueues() {
    try {
      const response = await this.client.get('/services/queueing/api/queues');
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:error:${this.instanceName_}`, { operation: 'listQueues', error: error.message });
      throw error;
    }
  }

  /**
   * Removes all jobs from a queue via the remote queueing service.
   * Permanently deletes all pending and active jobs in the queue.
   * This operation is irreversible - use with caution in production.
   *
   * @param {string} queueName The name of the queue to purge
   * @return {Promise<void>} A promise that resolves when the queue is successfully purged
   * @throws {Error} When the HTTP request fails or the queue does not exist
   *
   * @example
   * // Clear all jobs from a queue (e.g., after a deployment)
   * await queueApi.purge('emails');
   * console.log('Queue cleared');
   */
  async purge(queueName) {
    this.validateQueueName_(queueName, 'purge');
    try {
      await this.client.delete(`/services/queueing/api/purge/${queueName}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:purge:${this.instanceName_}`, { queueName });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit(`queue:error:${this.instanceName_}`, { operation: 'purge', queueName, error: error.message });
      throw error;
    }
  }
}

module.exports = QueueingApi;
