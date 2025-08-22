/**
 * @fileoverview Workflow Service
 * Service for defining and executing multi-step workflows with worker thread support.
 * Provides sequential step execution with error handling and event emission.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const { Worker } = require('worker_threads');
const path = require('path');
const Routes = require('./routes');
const Views = require('./views');

/**
 * WorkflowService class for managing and executing workflows.
 * Uses worker threads to execute individual steps in isolation.
 */
class WorkflowService {
  /**
   * Creates a new WorkflowService instance.
   * @param {EventEmitter} eventEmitter - Global event emitter for workflow events
   */
  constructor(eventEmitter) {
    /** @private {Map<string, Array<string>>} Map of workflow names to step file paths */
    this.workflows = new Map();

    /** @private {EventEmitter} Global event emitter */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Defines a new workflow with specified steps.
   * @param {string} workflowName - Unique name for the workflow
   * @param {Array<string>} steps - Array of file paths to step implementations
   * @throws {Error} When workflowName is invalid or steps array is empty
   */
  async defineWorkflow(workflowName, steps) {
    if (!workflowName || typeof workflowName !== 'string') {
      throw new Error('Workflow name must be a non-empty string');
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('Steps must be a non-empty array of file paths');
    }

    this.workflows.set(workflowName, steps);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('workflow:defined', { workflowName, steps });
    }
  }

  /**
   * Executes a defined workflow with the provided data.
   * Each step receives the output of the previous step as input.
   * @param {string} workflowName - Name of the workflow to execute
   * @param {Object} data - Initial data object to pass to first step
   * @param {function} statusCallback - Callback function for workflow progress updates
   * @throws {Error} When workflow is not found or step execution fails
   */
  async runWorkflow(workflowName, data, statusCallback) {
    const steps = this.workflows.get(workflowName);
    if (!steps) {
      const error = new Error(`Workflow '${workflowName}' not found.`);
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('workflow:error', {
          workflowName,
          error: error.message,
        });
      }
      throw error;
    }

    let currentData = data;

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('workflow:start', {
        workflowName,
        initialData: data,
      });
    }

    for (let i = 0; i < steps.length; i++) {
      const stepPath = steps[i];
      const stepName = `Step ${i + 1}: ${path.basename(stepPath)}`;

      statusCallback({
        status: 'step_start',
        stepName,
        stepPath,
        data: currentData,
      });
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:step:start', {
          workflowName,
          stepName,
          stepPath,
          data: currentData,
        });

      try {
        const worker = new Worker(
          path.resolve(__dirname, './provider/workerRunner.js'),
          {
            workerData: { stepPath, data: currentData },
          },
        );

        currentData = await new Promise((resolve, reject) => {
          worker.on('message', (message) => {
            if (message.type === 'result') {
              worker.terminate();
              resolve(message.data);
            } else if (message.type === 'error') {
              worker.terminate();
              reject(new Error(message.error));
            }
          });
          worker.on('error', (error) => {
            worker.terminate();
            reject(error);
          });
          worker.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`Worker stopped with exit code ${code}`));
            }
          });
        });

        statusCallback({
          status: 'step_end',
          stepName,
          stepPath,
          data: currentData,
        });
        if (this.eventEmitter_)
          this.eventEmitter_.emit('workflow:step:end', {
            workflowName,
            stepName,
            stepPath,
            data: currentData,
          });
      } catch (error) {
        statusCallback({
          status: 'step_error',
          stepName,
          stepPath,
          error: error.message,
        });
        if (this.eventEmitter_)
          this.eventEmitter_.emit('workflow:step:error', {
            workflowName,
            stepName,
            stepPath,
            error: error.message,
          });
        throw error; // Re-throw to stop workflow execution on error
      }
    }

    statusCallback({
      status: 'workflow_complete',
      workflowName,
      finalData: currentData,
    });
    if (this.eventEmitter_)
      this.eventEmitter_.emit('workflow:complete', {
        workflowName,
        finalData: currentData,
      });
  }
}

/**
 * Creates a workflow service instance with the specified configuration.
 * Automatically configures routes and views for the workflow service.
 * @param {string} type - The workflow provider type (currently only supports 'memory')
 * @param {Object} options - Provider-specific configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {WorkflowService} Workflow service instance
 */
function createWorkflowService(type, options, eventEmitter) {
  const workflow = new WorkflowService(eventEmitter);

  // Initialize routes and views for the workflow service
  Routes(options, eventEmitter, workflow);
  Views(options, eventEmitter, workflow);

  return workflow;
}

module.exports = createWorkflowService;
