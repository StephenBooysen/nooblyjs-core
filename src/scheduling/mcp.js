/**
 * @fileoverview MCP tools for the scheduling service (feature 03). Reads show
 * tasks and runs; `pause` and `resume` change state.
 * @module scheduling/mcp
 */

'use strict';

const TASK = { type: 'string', minLength: 1, maxLength: 200 };

/**
 * @param {Object} scheduling The scheduling instance
 * @return {!Array<Object>}
 */
module.exports = function tools(scheduling) {
  return [
    {
      name: 'tasks',
      description: 'Scheduled tasks with their cron or interval and whether they are paused.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => scheduling.listSchedules()
    },
    {
      name: 'runs',
      description: 'Recent runs, newest first, optionally of one task.',
      inputSchema: {
        type: 'object',
        properties: { taskName: TASK, limit: { type: 'integer', minimum: 1, maximum: 50 } }
      },
      handler: async (args) => scheduling.listRuns({ taskName: args.taskName, limit: args.limit || 20 })
    },
    {
      name: 'stats',
      description: 'Scheduling totals: tasks, runs and failures.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => scheduling.getStats()
    },
    {
      name: 'pause',
      description: 'Pause a scheduled task. Changes state.',
      write: true,
      inputSchema: { type: 'object', required: ['taskName'], properties: { taskName: TASK } },
      handler: async (args) => ({ paused: await scheduling.pause(args.taskName) })
    },
    {
      name: 'resume',
      description: 'Resume a paused task. Changes state.',
      write: true,
      inputSchema: { type: 'object', required: ['taskName'], properties: { taskName: TASK } },
      handler: async (args) => ({ resumed: await scheduling.resume(args.taskName) })
    }
  ];
};
