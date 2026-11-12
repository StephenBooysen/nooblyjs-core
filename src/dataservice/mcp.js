/**
 * @fileoverview MCP tools for the dataservice (feature 03). Reads are
 * `find` and `count`; `remove` changes data.
 * @module dataservice/mcp
 */

'use strict';

const CONTAINER = { type: 'string', minLength: 1, maxLength: 200 };

/**
 * @param {Object} data The dataservice instance
 * @return {!Array<Object>}
 */
module.exports = function tools(data) {
  return [
    {
      name: 'find',
      description: 'Objects in a container whose content matches a term (empty term lists them all).',
      inputSchema: {
        type: 'object',
        required: ['containerName'],
        properties: {
          containerName: CONTAINER,
          searchTerm: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 200 }
        }
      },
      handler: async (args) => {
        const found = await data.find(args.containerName, args.searchTerm || '');
        return Array.isArray(found) ? found.slice(0, args.limit || 50) : found;
      }
    },
    {
      name: 'count',
      description: 'How many objects a container holds.',
      inputSchema: { type: 'object', required: ['containerName'], properties: { containerName: CONTAINER } },
      handler: async (args) => ({ containerName: args.containerName, count: await data.count(args.containerName) })
    },
    {
      name: 'remove',
      description: 'Delete one object from a container. Deletes data; ask the user first.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['containerName', 'objectKey'],
        properties: { containerName: CONTAINER, objectKey: { type: 'string', minLength: 1, maxLength: 200 } }
      },
      handler: async (args) => ({ removed: await data.remove(args.containerName, args.objectKey) })
    }
  ];
};
