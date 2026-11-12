/**
 * @fileoverview MCP tools for the caching service (feature 03). Values are not
 * readable through MCP: the app keeps session data in cache instances, so a
 * `get` tool would expose tokens. The tools show statistics and can delete.
 * @module caching/mcp
 */

'use strict';

/**
 * @param {Object} cache The caching instance
 * @return {!Array<Object>}
 */
module.exports = function tools(cache) {
  return [
    {
      name: 'stats',
      description: 'Cache hit, miss and size figures for this cache instance.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => (typeof cache.getAnalytics === 'function' ? cache.getAnalytics() : {})
    },
    {
      name: 'delete',
      description: 'Remove one key from the cache. Values are not returned. Changes state.',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string', minLength: 1, maxLength: 500 } }
      },
      handler: async (args) => ({ deleted: await cache.delete(args.key) })
    }
  ];
};
