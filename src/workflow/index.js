/**
 * @fileoverview Workflow service for defining and executing sequential workflows.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const Routes = require('./routes');

class WorkflowService {
  constructor(eventEmitter) {
    this.workflows = new Map();
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Defines a new workflow.
   * @param {string} workflowName - The name of the workflow.
   * @param {Array<string>} steps - An array of paths to Node.js files, each representing a step.
   */
  async defineWorkflow(workflowName, steps) {
    this.workflows.set(workflowName, steps);
    if (this.eventEmitter_)
      this.eventEmitter_.emit('workflow:defined', { workflowName, steps });
  }

  /**
   * Runs a defined workflow.
   * @param {string} workflowName - The name of the workflow to execute.
   * @param {object} data - The data object to pass to each step.
   * @param {function} statusCallback - Callback for status updates (step start/end, workflow complete).
   */
  async runWorkflow(workflowName, data, statusCallback) {
    const steps = this.workflows.get(workflowName);
    if (!steps) {
      const error = new Error(`Workflow '${workflowName}' not found.`);
      if (this.eventEmitter_)
        this.eventEmitter_.emit('workflow:error', {
          workflowName,
          error: error.message,
        });
      throw error;
    }

    let currentData = data;
    if (this.eventEmitter_)
      this.eventEmitter_.emit('workflow:start', {
        workflowName,
        initialData: data,
      });

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
 * Creates a WorkflowService instance.
 * @param {string} type The type of workflow service to create. (Currently only 'default' is supported).
 * @param {Object=} options Options for the workflow service (currently not used).
 * @param {EventEmitter=} eventEmitter Optional EventEmitter instance for event bubbling.
 * @return {!WorkflowService} A WorkflowService instance.
 */
function createWorkflowService(type, options, eventEmitter) {
  const workflow = new WorkflowService(eventEmitter);
  Routes(options, eventEmitter, workflow);
  return workflow;
}

module.exports = createWorkflowService;
