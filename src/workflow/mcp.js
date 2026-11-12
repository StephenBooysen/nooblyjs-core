/**
 * @fileoverview MCP tools for the workflow service (feature 03). Reads inspect
 * workflows and runs. `run` and `cancel` change state.
 * @module workflow/mcp
 */

'use strict';

const NAME = { type: 'string', minLength: 1, maxLength: 200 };
const ID = { type: 'string', minLength: 1, maxLength: 200 };

/**
 * @param {Object} workflow The workflow instance
 * @return {!Array<Object>}
 */
module.exports = function tools(workflow) {
  return [
    {
      name: 'list',
      description: 'Workflows defined in this app, with their latest state.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => workflow.listWorkflows({})
    },
    {
      name: 'runs',
      description: 'Recent runs of one workflow, newest first.',
      inputSchema: {
        type: 'object',
        required: ['workflowName'],
        properties: { workflowName: NAME, limit: { type: 'integer', minimum: 1, maximum: 100 } }
      },
      handler: async (args) => workflow.listWorkflowExecutions(args.workflowName, { limit: args.limit || 20 })
    },
    {
      name: 'run_get',
      description: 'One run in full: its status, steps and the error of any failed step.',
      inputSchema: { type: 'object', required: ['executionId'], properties: { executionId: ID } },
      handler: async (args) => workflow.getExecution(args.executionId)
    },
    {
      name: 'stats',
      description: 'Run totals and failure rates across workflows.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => workflow.getExecutionStats({})
    },
    {
      name: 'run',
      description: 'Start a workflow with an input object and wait for it to finish. Changes state.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['workflowName'],
        properties: { workflowName: NAME, input: { type: 'object' } }
      },
      handler: async (args) => workflow.executeWorkflow(args.workflowName, args.input || {})
    },
    {
      name: 'cancel',
      description: 'Cancel a running execution. Changes state.',
      write: true,
      inputSchema: { type: 'object', required: ['executionId'], properties: { executionId: ID } },
      handler: async (args) => ({ cancelled: workflow.cancelExecution(args.executionId) })
    }
  ];
};
