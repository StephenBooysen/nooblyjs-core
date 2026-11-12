/**
 * @fileoverview Assembles the MCP server for one request (feature 03).
 *
 * Each service declares its tools in an optional `src/{service}/mcp.js`:
 *
 *   module.exports = function tools(instance, ctx) {
 *     return [{ name: 'find', description, inputSchema, write: false,
 *               handler: async (args) => result }];
 *   };
 *
 * The registry only aggregates them. A tool is named `{service}_{name}`, and
 * is bound to the service's `default` instance (or its first instance).
 *
 * Write tools are hidden and refused unless `mcp.allowWrite` is set and the
 * caller may write. Every call emits `mcp:tool:called` for the audit log.
 *
 * @module mcp/server
 */

'use strict';

const path = require('node:path');
const { McpError, ERROR } = require('./protocol');
const { validateArguments } = require('./schema');
const { toContent } = require('./output');
const { ClientError } = require('../shared/utils/httpErrors');
const platform = require('./platform');

/** Services that declare MCP tools. Add a service here when it gets an mcp.js. */
const TOOL_SERVICES = Object.freeze([
  'logging', 'queueing', 'dataservice', 'searching', 'workflow', 'scheduling', 'caching', 'knowledge'
]);

/**
 * Picks the instance a service's tools act on.
 * @param {!Map<string, Object>} services Registry instances keyed `service:provider:instance`
 * @param {string} service
 * @return {?Object}
 */
function instanceOf(services, service) {
  let first = null;
  for (const [key, instance] of services) {
    if (!key.startsWith(`${service}:`)) continue;
    if (key.endsWith(':default')) return instance;
    if (!first) first = instance;
  }
  return first;
}

/**
 * Collects the tools every instantiated service declares.
 * @param {!Map<string, Object>} services
 * @param {Object} ctx Context passed to each service's tools()
 * @return {!Array<Object>} Tool descriptors with prefixed names
 */
function collectTools(services, ctx) {
  const tools = [];
  for (const service of TOOL_SERVICES) {
    const instance = instanceOf(services, service);
    if (!instance) continue;
    let factory;
    try {
      factory = require(path.join(__dirname, '..', service, 'mcp.js'));
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    for (const tool of factory(instance, ctx)) {
      tools.push({ ...tool, name: `${service}_${tool.name}`, service });
    }
  }
  return tools;
}

/**
 * Builds the server object the protocol layer calls.
 *
 * @param {Object} input
 * @param {!Map<string, Object>} input.services Registry instances
 * @param {Object} input.serverInfo `{name, version}`
 * @param {boolean} input.allowWrite `mcp.allowWrite` from the app config
 * @param {boolean} input.canWrite Whether this caller may use write tools
 * @param {boolean=} input.admin Whether this caller is an administrator (reads every knowledge role)
 * @param {Array<string>} input.roles Roles the caller reads knowledge with
 * @param {string} input.actor Who is calling, for the audit log (email or key name)
 * @param {EventEmitter=} input.eventEmitter Receives `mcp:tool:called`
 * @param {!Object=} input.app Express app (for the OpenAPI resource)
 * @param {!Object=} input.registry Service registry (for the services resource)
 * @return {!Object} Server object for protocol.handle()
 */
function createServer({ services, serverInfo, allowWrite, canWrite, admin, roles, actor, eventEmitter, app, registry }) {
  const writeAllowed = Boolean(allowWrite && canWrite);
  const ctx = { roles: roles || [], admin: Boolean(admin), actor, app, registry };
  const extra = platform.build({ registry, app, services, ctx });
  const visible = () => [...collectTools(services, ctx), ...extra.tools].filter((t) => !t.write || writeAllowed);

  return {
    serverInfo,
    instructions: 'NooblyJS app tools. Read tools inspect logs, queues, data, search, workflows, schedules, cache and knowledge. '
      + (writeAllowed ? 'Write tools change state and need the caller to confirm.' : 'Write tools are disabled for this server.'),

    async listTools() {
      return visible().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },

    async callTool(name, args) {
      const tool = visible().find((t) => t.name === name);
      if (!tool) throw new McpError(ERROR.INVALID_PARAMS, `Unknown tool "${name}"`);
      const problem = validateArguments(tool.inputSchema, args);
      if (problem) throw new McpError(ERROR.INVALID_PARAMS, problem);

      const started = Date.now();
      let outcome = 'ok';
      try {
        const result = await tool.handler(args || {}, ctx);
        return { content: [toContent(result)], isError: false };
      } catch (error) {
        outcome = 'error';
        const message = error instanceof ClientError ? error.message : 'The tool failed. See the server log for details.';
        return { content: [{ type: 'text', text: message }], isError: true };
      } finally {
        eventEmitter?.emit('mcp:tool:called', {
          tool: name,
          outcome,
          write: Boolean(tool.write),
          actor,
          durationMs: Date.now() - started
        });
      }
    },

    async listResources() {
      return extra.resources.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }));
    },

    async readResource(uri) {
      const resource = extra.resources.find((r) => r.uri === uri);
      if (!resource) throw new McpError(ERROR.INVALID_PARAMS, `Unknown resource "${uri}"`);
      const body = await resource.read();
      return { uri, mimeType: resource.mimeType, text: typeof body === 'string' ? body : JSON.stringify(body, null, 2) };
    },

    async listPrompts() {
      return extra.prompts.map(({ name, description, arguments: args }) => ({ name, description, arguments: args || [] }));
    },

    async getPrompt(name, args) {
      const prompt = extra.prompts.find((p) => p.name === name);
      if (!prompt) throw new McpError(ERROR.INVALID_PARAMS, `Unknown prompt "${name}"`);
      const problem = validateArguments({ type: 'object', required: (prompt.arguments || []).filter((a) => a.required).map((a) => a.name), properties: Object.fromEntries((prompt.arguments || []).map((a) => [a.name, { type: 'string', maxLength: 200 }])) }, args);
      if (problem) throw new McpError(ERROR.INVALID_PARAMS, problem);
      return {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }]
      };
    }
  };
}

module.exports = { createServer, collectTools, instanceOf, TOOL_SERVICES };
