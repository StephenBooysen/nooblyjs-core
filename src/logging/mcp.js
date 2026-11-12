/**
 * @fileoverview MCP tools for the logging service (feature 03). Read only.
 * @module logging/mcp
 */

'use strict';

const LEVEL = { type: 'string', enum: ['debug', 'info', 'warn', 'error'] };

/**
 * @param {Object} logger The logging instance (its `analytics` holds recent entries)
 * @return {!Array<Object>} Tool descriptors
 */
module.exports = function tools(logger) {
  const analytics = () => logger.analytics || null;
  return [
    {
      name: 'recent',
      description: 'Recent log entries, oldest first. Optionally only one level.',
      inputSchema: {
        type: 'object',
        properties: { level: LEVEL, limit: { type: 'integer', minimum: 1, maximum: 200 } }
      },
      handler: async (args) => {
        const entries = analytics()?.list(args.level) || [];
        return entries.slice(-(args.limit || 50));
      }
    },
    {
      name: 'counts',
      description: 'How many log entries this process has written, in total and by level.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const a = analytics();
        return { total: a?.getCount() ?? null, byLevel: a?.getStats() ?? null };
      }
    }
  ];
};
