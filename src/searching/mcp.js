/**
 * @fileoverview MCP tools for the searching service (feature 03). Read only.
 * @module searching/mcp
 */

'use strict';

/**
 * @param {Object} search The searching instance
 * @return {!Array<Object>}
 */
module.exports = function tools(search) {
  return [
    {
      name: 'query',
      description: 'Search an index for a word or phrase and return the best matches.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 1000 },
          container: { type: 'string', maxLength: 200 },
          limit: { type: 'integer', minimum: 1, maximum: 100 }
        }
      },
      handler: async (args) => {
        const results = await search.search(args.query, args.container || 'default');
        return Array.isArray(results) ? results.slice(0, args.limit || 20) : results;
      }
    }
  ];
};
