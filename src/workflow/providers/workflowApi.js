/**
 * @fileoverview API-based workflow service implementation that proxies requests to a remote workflow service.
 * Allows client applications to consume backend workflow API endpoints for enterprise systems.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const axios = require('axios');

/**
 * A class that implements workflow operations via HTTP API calls to a remote service.
 * Provides methods for creating, executing, and managing workflows through REST endpoints.
 * @class
 */
class WorkflowApi {
  /**
   * Initializes the Workflow API client with configuration.
   * @param {Object} options Configuration options for the API client.
   * @param {string} options.apiRoot The root URL of the backend API service.
   * @param {string=} options.apiKey Optional API key for authenticated requests.
   * @param {number=} options.timeout Request timeout in milliseconds (default: 30000).
   * @param {EventEmitter=} eventEmitter Optional event emitter for workflow events.
   */
  constructor(options = {}, eventEmitter) {
    this.apiRoot = options.apiRoot || 'http://localhost:3000';
    this.apiKey = options.apiKey || null;
    this.timeout = options.timeout || 30000;
    this.eventEmitter_ = eventEmitter;

    // Configure axios instance
    this.client = axios.create({
      baseURL: this.apiRoot,
      timeout: this.timeout,
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });

    // Settings for workflow API provider
    this.settings = {};
    this.settings.description = "Configuration settings for the Workflow API Provider";
    this.settings.list = [
      {setting: "apiUrl", type: "string", values: ["http://localhost:3000"]},
      {setting: "timeout", type: "number", values: [30000]},
      {setting: "retryLimit", type: "number", values: [3]}
    ];
    this.settings.apiUrl = options.apiUrl || this.settings.list[0].values[0];
    this.settings.timeout = options.timeout || this.settings.list[1].values[0];
    this.settings.retryLimit = options.retryLimit || this.settings.list[2].values[0];
  }

  /**
   * Creates a new workflow definition via the remote workflow service.
   * Submits a workflow definition (steps, dependencies, configuration) to be stored and managed.
   * Returns the created workflow with an assigned ID and metadata.
   *
   * @param {Object} workflow The workflow definition containing:
   *   - name: {string} Workflow name
   *   - steps: {Array} Array of step definitions
   *   - description: {string} Optional workflow description
   *   - Other provider-specific properties
   * @return {Promise<Object>} A promise that resolves to the created workflow object including:
   *   - id: {string} Unique workflow identifier
   *   - name: {string} Workflow name
   *   - createdAt: {string} ISO timestamp of creation
   * @throws {Error} When the HTTP request fails or the workflow definition is invalid
   *
   * @example
   * // Create a workflow with multiple steps
   * const workflow = {
   *   name: 'order-processing',
   *   steps: [
   *     { type: 'validate-order', config: { strict: true } },
   *     { type: 'process-payment', config: { retries: 3 } },
   *     { type: 'send-confirmation', config: {} }
   *   ]
   * };
   * const created = await workflowApi.create(workflow);
   * console.log(`Workflow created with ID: ${created.id}`);
   */
  async create(workflow) {
    try {
      const response = await this.client.post('/services/workflow/api/create', workflow);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:create', { workflow: response.data });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', { operation: 'create', error: error.message });
      throw error;
    }
  }

  /**
   * Executes a workflow via the remote workflow service.
   * Triggers execution of a previously defined workflow with optional context data.
   * Returns the execution result or execution ID for tracking status.
   *
   * @param {string} workflowId The unique identifier of the workflow to execute
   * @param {Object} [context] Optional execution context containing:
   *   - variables: {Object} Input variables for the workflow
   *   - userId: {string} User ID executing the workflow
   *   - metadata: {Object} Additional execution metadata
   * @return {Promise<Object>} A promise that resolves to the execution result containing:
   *   - executionId: {string} Unique execution identifier
   *   - status: {string} Execution status ('completed', 'running', 'failed')
   *   - result: {*} Final workflow result
   * @throws {Error} When the HTTP request fails, workflow doesn't exist, or execution fails
   *
   * @example
   * // Execute a workflow with context
   * const result = await workflowApi.execute('workflow-123', {
   *   variables: { orderId: 'order-456', userId: 'user-789' }
   * });
   * console.log(`Execution status: ${result.status}`);
   */
  async execute(workflowId, context = {}) {
    try {
      const response = await this.client.post(`/services/workflow/api/execute/${workflowId}`, { context });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:execute', { workflowId, result: response.data });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', { operation: 'execute', workflowId, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves a workflow definition by ID via the remote workflow service.
   * Returns the complete workflow definition including steps and configuration.
   *
   * @param {string} workflowId The unique identifier of the workflow
   * @return {Promise<Object>} A promise that resolves to the workflow definition object
   * @throws {Error} When the HTTP request fails or the workflow does not exist
   *
   * @example
   * // Get a workflow definition
   * const workflow = await workflowApi.get('workflow-123');
   * console.log(`Workflow steps: ${workflow.steps.length}`);
   */
  async get(workflowId) {
    try {
      const response = await this.client.get(`/services/workflow/api/workflow/${workflowId}`);
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', { operation: 'get', workflowId, error: error.message });
      throw error;
    }
  }

  /**
   * Lists all workflows via the remote workflow service.
   * Returns a list of all workflow definitions managed by the service.
   *
   * @return {Promise<Array>} A promise that resolves to an array of workflow objects
   * @throws {Error} When the HTTP request fails
   *
   * @example
   * // List all workflows
   * const workflows = await workflowApi.list();
   * console.log(`Total workflows: ${workflows.length}`);
   */
  async list() {
    try {
      const response = await this.client.get('/services/workflow/api/workflows');
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', { operation: 'list', error: error.message });
      throw error;
    }
  }

  /**
   * Updates a workflow definition via the remote workflow service.
   * Modifies specific fields of an existing workflow. Unmodified fields are preserved.
   *
   * @param {string} workflowId The unique identifier of the workflow to update
   * @param {Object} updates An object containing the fields to update:
   *   - name: {string} New workflow name
   *   - steps: {Array} Updated step definitions
   *   - description: {string} Updated description
   * @return {Promise<Object>} A promise that resolves to the updated workflow object
   * @throws {Error} When the HTTP request fails or the workflow does not exist
   *
   * @example
   * // Update workflow steps
   * const updated = await workflowApi.update('workflow-123', {
   *   steps: [
   *     { type: 'validate-order', config: { strict: true } },
   *     { type: 'new-step', config: {} }
   *   ]
   * });
   */
  async update(workflowId, updates) {
    try {
      const response = await this.client.put(`/services/workflow/api/workflow/${workflowId}`, updates);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:update', { workflowId, updates });
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', { operation: 'update', workflowId, error: error.message });
      throw error;
    }
  }

  /**
   * Deletes a workflow definition via the remote workflow service.
   * Permanently removes a workflow and its execution history.
   *
   * @param {string} workflowId The unique identifier of the workflow to delete
   * @return {Promise<void>} A promise that resolves when the workflow is successfully deleted
   * @throws {Error} When the HTTP request fails or the workflow does not exist
   *
   * @example
   * // Delete a workflow
   * await workflowApi.delete('workflow-123');
   * console.log('Workflow deleted');
   */
  async delete(workflowId) {
    try {
      await this.client.delete(`/services/workflow/api/workflow/${workflowId}`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:delete', { workflowId });
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', { operation: 'delete', workflowId, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves the execution status of a workflow execution via the remote workflow service.
   * Returns current state, progress, and results of an ongoing or completed workflow execution.
   *
   * @param {string} executionId The unique identifier of the execution to check
   * @return {Promise<Object>} A promise that resolves to the execution status object containing:
   *   - executionId: {string} Unique execution identifier
   *   - workflowId: {string} Associated workflow ID
   *   - status: {string} Current status ('running', 'completed', 'failed')
   *   - progress: {number} Execution progress as percentage (0-100)
   *   - startedAt: {string} ISO timestamp when execution started
   *   - completedAt: {string} ISO timestamp when execution completed (if done)
   * @throws {Error} When the HTTP request fails or the execution does not exist
   *
   * @example
   * // Check workflow execution status
   * const status = await workflowApi.getExecutionStatus('exec-123');
   * console.log(`Progress: ${status.progress}%`);
   * if (status.status === 'completed') {
   *   console.log('Workflow execution completed');
   * }
   */
  async getExecutionStatus(executionId) {
    try {
      const response = await this.client.get(`/services/workflow/api/execution/${executionId}`);
      return response.data;
    } catch (error) {
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', { operation: 'getExecutionStatus', executionId, error: error.message });
      throw error;
    }
  }

  /**
   * Retrieves all current configuration settings for the workflow API provider.
   * Returns the settings object including API URL, timeout, and retry configuration.
   *
   * @return {Promise<Object>} A promise that resolves to the settings object containing:
   *   - description: {string} Description of the provider
   *   - list: {Array} Array of configurable settings definitions
   *   - apiUrl: {string} The remote API URL
   *   - timeout: {number} Request timeout in milliseconds
   *   - retryLimit: {number} Maximum number of retry attempts
   *
   * @example
   * const settings = await workflowApi.getSettings();
   * console.log(`API URL: ${settings.apiUrl}`);
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Updates configuration settings for the workflow API provider.
   * Only specified settings are updated; unspecified settings are left unchanged.
   *
   * @param {Object} settings The settings object containing new values
   * @param {string} [settings.apiUrl] The new remote API URL
   * @param {number} [settings.timeout] The new request timeout in milliseconds
   * @param {number} [settings.retryLimit] The new retry limit
   * @return {Promise<void>} A promise that resolves when all settings are updated
   *
   * @example
   * // Update API timeout
   * await workflowApi.saveSettings({
   *   timeout: 45000,
   *   apiUrl: 'https://workflow-api.internal.service'
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

module.exports = WorkflowApi;
