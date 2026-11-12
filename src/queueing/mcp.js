/**
 * @fileoverview MCP tools for the queueing service (feature 03).
 * @module queueing/mcp
 */

'use strict';

const QUEUE = { type: 'string', minLength: 1, maxLength: 200 };

/**
 * @param {Object} queue The queueing instance
 * @return {!Array<Object>}
 */
module.exports = function tools(queue) {
  return [
    {
      name: 'list',
      description: 'Names of the queues that exist.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ queues: await queue.listQueues() })
    },
    {
      name: 'size',
      description: 'How many items are waiting in one queue.',
      inputSchema: { type: 'object', required: ['queueName'], properties: { queueName: QUEUE } },
      handler: async (args) => ({ queueName: args.queueName, size: await queue.size(args.queueName) })
    },
    {
      name: 'enqueue',
      description: 'Add an item to a queue. Changes state.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['queueName', 'item'],
        properties: { queueName: QUEUE, item: { type: 'object' } }
      },
      handler: async (args) => {
        await queue.enqueue(args.queueName, args.item);
        return { queued: true, queueName: args.queueName };
      }
    },
    {
      name: 'purge',
      description: 'Remove every waiting item from a queue. Deletes data; ask the user first.',
      write: true,
      inputSchema: { type: 'object', required: ['queueName'], properties: { queueName: QUEUE } },
      handler: async (args) => {
        await queue.purge(args.queueName);
        return { purged: true, queueName: args.queueName };
      }
    }
  ];
};
