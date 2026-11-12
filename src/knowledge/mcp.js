/**
 * @fileoverview MCP tools for the knowledge service (feature 03). Answers use
 * the caller's roles, so an agent sees only what the caller may read.
 * @module knowledge/mcp
 */

'use strict';

/**
 * @param {Object} kb The knowledge instance
 * @param {{roles: Array<string>}} ctx Caller context
 * @return {!Array<Object>}
 */
module.exports = function tools(kb, ctx) {
  return [
    {
      name: 'ask',
      description: 'Answer a question from the knowledge base, with numbered citations.',
      inputSchema: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string', minLength: 1, maxLength: 1000 },
          k: { type: 'integer', minimum: 1, maximum: 20 }
        }
      },
      handler: async (args) => kb.ask(args.question, {
        k: args.k,
        roles: ctx.admin ? ['*', ...kb.allRoles()] : ctx.roles
      })
    },
    {
      name: 'status',
      description: 'Knowledge base size, last sync and whether answers are configured.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => kb.status()
    },
    {
      name: 'sources',
      description: 'The indexed files, with their titles and chunk counts.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => kb.sources()
    },
    {
      name: 'sync',
      description: 'Re-index changed files from the source. Changes state.',
      write: true,
      inputSchema: { type: 'object', properties: {} },
      handler: async () => kb.sync()
    }
  ];
};
