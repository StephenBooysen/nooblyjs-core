/**
 * @fileoverview API-based working service implementation that proxies requests to a remote working service.
 * Allows client applications to consume backend working API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements worker/job operations via HTTP API calls to a remote service.
 * Provides methods for managing background workers and jobs through REST endpoints.
 * @class
 */
class WorkingApi {
  /**
   * Initializes the Working API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.url The root URL of the backend API service.
   * @param {string=} options.apikey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 30000).
   * @param {number=} options.retryLimit Request retryLimit (default:3)
   * @param {EventEmitter=} eventEmitter Optional event emitter for working events.
   */
  constructor(options = {}, eventEmitter) {

    this.settings = {};
    this.settings.description = "Configuration settings for the Working API Provider";
    this.settings.list = [
      {setting: "url", type: "string", values: ["http://localhost:3000"]},
      {setting: "apikey", type: "string", values: ["Please request this from your administrator"]},
      {setting: "timeout", type: "number", values: [30000]},
      {setting: "retryLimit", type: "number", values: [3]}
    ];
    this.settings.url = options.url || 'http://localhost:3000';
    this.settings.apikey = options.apikey || null;
    this.settings.timeout = options.timeout || 30000;
    this.settings.retryLimit = options.retryLimit || 3;

    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;

    // Configure axios instance
    this.client = axios.create({
      baseURL: this.settings.url,
      timeout: this.settings.timeout,
      headers: this.settings.apikey ? { 'X-API-Key': this.settings.apikey } : {}
    });

  }

  /**
   * Submits a job to the remote working service for asynchronous execution.
   * Sends a job/activity to be processed by worker threads or processes.
   * Returns immediately with a job ID for tracking.
   *
   * @param {Object} job The job/activity definition containing:
   *   - type: {string} Job type identifier
   *   - data: {*} Job payload and parameters
   *   - priority: {number} Optional job priority
   *   - timeout: {number} Optional execution timeout in milliseconds
   * @return {Promise<Object>} A promise that resolves to the job submission result including:
   *   - jobId: {string} Unique job identifier
   *   - status: {string} Initial status ('queued', 'pending')
   *   - createdAt: {string} ISO timestamp of job creation
   * @throws {Error} When the HTTP request fails or the job definition is invalid
   *
   * @example
   * // Submit a data processing job
   * const job = {
   *   type: 'process-data',
   *   data: { source: '/data/file.csv', destination: '/output/' },
   *   timeout: 60000
   * };
   * const result = await workingApi.submitJob(job);
   * console.log(`Job submitted with ID: ${result.jobId}`);
   */
  async submitJob(job) {
    try {
      const response = await this.client.post('/services/working/api/submit', job);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:submit', { job: response.data });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:error', { operation: 'submitJob', error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves the status of a submitted job via the remote working service.
   * Returns current execution state, progress, and any output or error messages.
   *
   * @param {string} jobId The unique identifier of the job to check
   * @return {Promise<Object>} A promise that resolves to the job status object containing:
   *   - jobId: {string} The job identifier
   *   - status: {string} Current status ('queued', 'running', 'completed', 'failed')
   *   - progress: {number} Execution progress as percentage (0-100)
   *   - result: {*} Job output (if completed)
   *   - error: {string} Error message (if failed)
   *   - startedAt: {string} ISO timestamp when execution started
   *   - completedAt: {string} ISO timestamp when execution completed (if done)
   * @throws {Error} When the HTTP request fails or the job does not exist
   *
   * @example
   * // Check job status
   * const status = await workingApi.getJobStatus('job-123');
   * if (status.status === 'completed') {
   *   console.log('Job result:', status.result);
   * }
   */
  async getJobStatus(jobId) {
    try {
      const response = await this.client.get(`/services/working/api/job/${jobId}`);
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:error', { operation: 'getJobStatus', jobId, error: error.message });
      throw error;
    }
  }

  /**
   * Cancels a running or queued job via the remote working service.
   * Attempts to stop execution of a job that has not yet completed.
   * If the job is already completed, cancellation has no effect.
   *
   * @param {string} jobId The unique identifier of the job to cancel
   * @return {Promise<void>} A promise that resolves when the cancellation is processed
   * @throws {Error} When the HTTP request fails or the job does not exist
   *
   * @example
   * // Cancel a long-running job
   * await workingApi.cancelJob('job-123');
   * console.log('Job cancellation requested');
   */
  async cancelJob(jobId) {
    try {
      await this.client.post(`/services/working/api/cancel/${jobId}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:cancel', { jobId });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:error', { operation: 'cancelJob', jobId, error: error.message });
      throw error;
    }
  }

  /**
   * Lists jobs via the remote working service with optional filtering.
   * Returns a list of jobs with their current status and metadata.
   *
   * @param {Object} [filter] Optional filter parameters including:
   *   - status: {string} Filter by job status ('queued', 'running', 'completed', 'failed')
   *   - type: {string} Filter by job type
   *   - limit: {number} Maximum number of jobs to return
   *   - offset: {number} Number of jobs to skip for pagination
   * @return {Promise<Array>} A promise that resolves to an array of job objects
   * @throws {Error} When the HTTP request fails
   *
   * @example
   * // List all running jobs
   * const running = await workingApi.listJobs({ status: 'running', limit: 10 });
   * console.log(`${running.length} jobs currently running`);
   */
  async listJobs(filter = {}) {
    try {
      const response = await this.client.get('/services/working/api/jobs', { params: filter });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:error', { operation: 'listJobs', error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves statistics about worker threads and job execution via the remote working service.
   * Returns performance metrics and system health information.
   *
   * @return {Promise<Object>} A promise that resolves to the statistics object containing:
   *   - activeWorkers: {number} Number of active worker threads
   *   - totalJobs: {number} Total jobs processed
   *   - queuedJobs: {number} Jobs waiting to be processed
   *   - completedJobs: {number} Successfully completed jobs
   *   - failedJobs: {number} Jobs that failed
   *   - avgExecutionTime: {number} Average job execution time in milliseconds
   *   - uptime: {number} Worker service uptime in seconds
   * @throws {Error} When the HTTP request fails
   *
   * @example
   * // Get worker statistics
   * const stats = await workingApi.getStats();
   * console.log(`Active workers: ${stats.activeWorkers}`);
   * console.log(`Job completion rate: ${(stats.completedJobs / stats.totalJobs * 100).toFixed(2)}%`);
   */
  async getStats() {
    try {
      const response = await this.client.get('/services/working/api/stats');
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:error', { operation: 'getStats', error: error.message });
      throw error;
    }
  }

  /**
   * Retries a previously failed job via the remote working service.
   * Re-queues a job that has failed, potentially with modified parameters.
   * The job is reprocessed with the same or updated configuration.
   *
   * @param {string} jobId The unique identifier of the job to retry
   * @return {Promise<Object>} A promise that resolves to the retry result including:
   *   - newJobId: {string} Unique identifier for the retry attempt
   *   - status: {string} Initial status of the retry ('queued')
   * @throws {Error} When the HTTP request fails, the job does not exist, or the job is not in a failed state
   *
   * @example
   * // Retry a failed job
   * const retry = await workingApi.retryJob('job-123');
   * console.log(`Retry submitted with new ID: ${retry.newJobId}`);
   */
  async retryJob(jobId) {
    try {
      const response = await this.client.post(`/services/working/api/retry/${jobId}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:retry', { jobId });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('working:error', { operation: 'retryJob', jobId, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves all current configuration settings for the working API provider.
   * Returns the settings object including API URL, timeout, and retry configuration.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Description of the provider
   *   - list: {Array} Array of configurable settings definitions
   *   - url: {string} The remote API URL
   *   - apikey: {string} API key for authentication
   *   - timeout: {number} Request timeout in milliseconds
   *   - retryLimit: {number} Maximum number of retry attempts
   *
   * @example
   * const settings = await workingApi.getSettings();
   * console.log(`API URL: ${settings.url}`);
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Updates configuration settings for the working API provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.url] The new remote API URL
   * @param {string} [settings.apikey] The new API key for authentication
   * @param {number} [settings.timeout] The new request timeout in milliseconds
   * @param {number} [settings.retryLimit] The new retry limit
   * @return {Promise<void>} A promise that resolves when all settings are updated
   *
   * @example
   * // Update API timeout
   * await workingApi.saveSettings({
   *   timeout: 45000,
   *   url: 'https://worker-api.internal.service'
   * });
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
}

module.exports = WorkingApi;
