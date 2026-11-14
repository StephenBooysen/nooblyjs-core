/**
 * @fileoverview MCP server for the service registry (feature 03).
 *
 * Exposes a running app's services to coding agents over the Model Context
 * Protocol: tools (read tools always, write tools only when enabled), resources
 * and prompts. The transport is Streamable HTTP: `POST /services/mcp` carries one
 * JSON-RPC message or a batch and answers with JSON. Off by default.
 *
 * Safety:
 * - The endpoint is mounted only when `mcp.enabled` is true.
 * - Each tool needs the permission a REST route for the same data needs, checked
 *   against the caller's roles, API-key scopes and token scopes.
 * - Write tools need `mcp.allowWrite` and the wildcard grant (admin).
 * - Every call emits `mcp:tool:called` with the principal, tool and outcome.
 * - Tool inputs are checked against each tool's JSON schema before they run.
 * - Results are capped in size.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const { permissionsForRoles, hasPermission } = require('../authservice/modules/permissions');
const { ClientError } = require('../shared/utils/httpErrors');
const { capLimit } = require('../shared/utils/validation');

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'nooblyjs-core', version: '1.0.14' };
const MAX_RESULT_ITEMS = 200;
const MAX_RESULT_BYTES = 256 * 1024;

const ERROR = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603, UNAUTHORIZED: -32001 };

/** JSON-RPC success response. */
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
/** JSON-RPC error response. */
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/**
 * Permissions a principal holds, as the permission gate computes them.
 *
 * @param {Object} principal Principal from the registry (roles, scopes, tokenScopes)
 * @return {{granted: string[], tokenScopes: ?string[]}} Grants and any token narrowing
 */
function grantsOf(principal) {
  if (!principal) return { granted: [], tokenScopes: null };
  let granted;
  if (Array.isArray(principal.roles)) granted = permissionsForRoles(principal.roles);
  else if (principal.scopes === null) granted = ['*'];
  else granted = Array.isArray(principal.scopes) ? principal.scopes : [];
  return { granted, tokenScopes: Array.isArray(principal.tokenScopes) ? principal.tokenScopes : null };
}

/**
 * Checks whether a principal may use a permission.
 * @param {Object} principal Principal from the registry
 * @param {string} needed Permission such as `queueing:read`
 * @return {boolean}
 */
function allows(principal, needed) {
  const { granted, tokenScopes } = grantsOf(principal);
  return hasPermission(granted, needed) && (!tokenScopes || hasPermission(tokenScopes, needed));
}

/**
 * Checks a value against the subset of JSON Schema the tools use: type, required,
 * properties, enum, items and additionalProperties.
 *
 * @param {*} value Value to check
 * @param {Object} schema JSON schema
 * @param {string} [where='input'] Name used in messages
 * @return {string|null} The first problem found, or null
 */
function schemaProblem(value, schema, where = 'input') {
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const ok = types.some((t) => (t === 'integer' ? Number.isInteger(value) : t === actual));
    if (!ok) return `${where} must be ${types.join(' or ')}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${where} must be one of ${schema.enum.join(', ')}`;
  if (schema.type === 'string' && schema.maxLength && value.length > schema.maxLength) return `${where} is longer than ${schema.maxLength} characters`;
  if (schema.type === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) return `${where}.${key} is required`;
    }
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) return `${where}.${key} is not an allowed field`;
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) {
        const problem = schemaProblem(value[key], sub, `${where}.${key}`);
        if (problem) return problem;
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    for (let i = 0; i < value.length; i += 1) {
      const problem = schemaProblem(value[i], schema.items, `${where}[${i}]`);
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * Caps a result so one call cannot return an unbounded payload.
 * @param {*} value Result of a tool
 * @return {{value: *, truncated: boolean}}
 */
function capResult(value) {
  if (Array.isArray(value) && value.length > MAX_RESULT_ITEMS) {
    return { value: value.slice(0, MAX_RESULT_ITEMS), truncated: true };
  }
  const text = JSON.stringify(value ?? null);
  if (text && text.length > MAX_RESULT_BYTES) {
    return { value: { truncated: true, preview: text.slice(0, MAX_RESULT_BYTES) }, truncated: true };
  }
  return { value, truncated: false };
}

/**
 * @param {*} value
 * @return {boolean} Whether the value is a plain JSON object (not an array or null)
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Builds the tool catalogue. Each tool names the permission it needs and whether
 * it writes. Services are read through accessor functions, so only the services a
 * tool uses are created.
 *
 * @param {Object} services Accessors: logger, queue, dataService, searching, workflow, scheduling, cache, settings, monitoring, describe
 * @return {Array<Object>} Tool definitions
 */
function buildTools(services) {
  const limitOf = (args) => capLimit(args.limit ?? 50, MAX_RESULT_ITEMS);
  return [
    {
      name: 'logs.recent',
      description: 'Recent log entries kept in memory by the logging service, newest last. Optional level filter.',
      permission: 'logging:read',
      write: false,
      inputSchema: {
        type: 'object',
        properties: { level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] }, limit: { type: 'integer' } },
        additionalProperties: false
      },
      run: async (args) => {
        const analytics = services.logger().analytics;
        const entries = (analytics?.list(args.level) || []).slice(-limitOf(args));
        return entries;
      }
    },
    {
      name: 'queue.stats',
      description: 'Waiting and total counts for a queue, and reliable-job counts when the provider supports them.',
      permission: 'queueing:read',
      write: false,
      inputSchema: { type: 'object', properties: { queue: { type: 'string', maxLength: 200 } }, required: ['queue'], additionalProperties: false },
      run: async (args) => {
        const queue = services.queue();
        const size = await queue.size(args.queue);
        const jobs = queue.supportsReliableJobs ? await queue.jobCounts(args.queue) : null;
        return { queue: args.queue, size, jobs };
      }
    },
    {
      name: 'data.count',
      description: 'Number of documents in a data container.',
      permission: 'dataservice:read',
      write: false,
      inputSchema: { type: 'object', properties: { container: { type: 'string', maxLength: 200 } }, required: ['container'], additionalProperties: false },
      run: async (args) => ({ container: args.container, count: await services.dataService().count(args.container) })
    },
    {
      name: 'data.find',
      description: 'Documents in a data container matching a search term, capped in number.',
      permission: 'dataservice:read',
      write: false,
      inputSchema: {
        type: 'object',
        properties: { container: { type: 'string', maxLength: 200 }, term: { type: 'string', maxLength: 500 }, limit: { type: 'integer' } },
        required: ['container'],
        additionalProperties: false
      },
      run: async (args) => {
        const found = await services.dataService().find(args.container, args.term || '');
        return (Array.isArray(found) ? found : []).slice(0, limitOf(args));
      }
    },
    {
      name: 'search.query',
      description: 'Full-text search over a search index.',
      permission: 'searching:read',
      write: false,
      inputSchema: {
        type: 'object',
        properties: { index: { type: 'string', maxLength: 200 }, query: { type: 'string', minLength: 1, maxLength: 500 }, limit: { type: 'integer' } },
        required: ['query'],
        additionalProperties: false
      },
      run: async (args) => {
        const results = await services.searching().search(args.query, args.index ? { containerName: args.index } : undefined);
        return (Array.isArray(results) ? results : results?.results || []).slice(0, limitOf(args));
      }
    },
    {
      name: 'workflow.listRuns',
      description: 'Recent workflow executions, optionally for one workflow.',
      permission: 'workflow:read',
      write: false,
      inputSchema: { type: 'object', properties: { workflow: { type: 'string', maxLength: 200 }, limit: { type: 'integer' } }, additionalProperties: false },
      run: async (args) => {
        const wf = services.workflow();
        const runs = args.workflow ? wf.listWorkflowExecutions(args.workflow, { limit: limitOf(args) }) : wf.listExecutions({ limit: limitOf(args) });
        return runs;
      }
    },
    {
      name: 'workflow.getRun',
      description: 'One workflow execution: status, steps and error.',
      permission: 'workflow:read',
      write: false,
      inputSchema: { type: 'object', properties: { executionId: { type: 'string', maxLength: 200 } }, required: ['executionId'], additionalProperties: false },
      run: async (args) => services.workflow().getExecution(args.executionId) || null
    },
    {
      name: 'scheduling.listSchedules',
      description: 'Scheduled tasks with their next run, state and last outcome.',
      permission: 'scheduling:read',
      write: false,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => services.scheduling().listSchedules()
    },
    {
      name: 'monitoring.snapshot',
      description: 'Process and host metrics: memory, CPU and uptime.',
      permission: '*',
      write: false,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => services.monitoring().getCurrentSnapshot()
    },
    {
      name: 'queue.enqueue',
      description: 'Adds one item to a queue. Write tool: needs mcp.allowWrite.',
      permission: '*',
      write: true,
      inputSchema: {
        type: 'object',
        properties: { queue: { type: 'string', maxLength: 200 }, item: {} },
        required: ['queue', 'item'],
        additionalProperties: false
      },
      run: async (args) => {
        await services.queue().enqueue(args.queue, args.item);
        return { queue: args.queue, enqueued: true };
      }
    },
    {
      name: 'queue.purge',
      description: 'Removes every waiting item from a queue. Write tool: needs mcp.allowWrite.',
      permission: '*',
      write: true,
      inputSchema: { type: 'object', properties: { queue: { type: 'string', maxLength: 200 } }, required: ['queue'], additionalProperties: false },
      run: async (args) => {
        await services.queue().purge(args.queue);
        return { queue: args.queue, purged: true };
      }
    },
    {
      name: 'workflow.run',
      description: 'Starts a workflow with an input. Write tool: needs mcp.allowWrite.',
      permission: '*',
      write: true,
      inputSchema: {
        type: 'object',
        properties: { workflow: { type: 'string', maxLength: 200 }, input: {} },
        required: ['workflow'],
        additionalProperties: false
      },
      run: async (args) => ({ executionId: services.workflow().startExecution(args.workflow, args.input ?? {}) })
    },
    {
      name: 'scheduling.pause',
      description: 'Pauses a scheduled task. Write tool: needs mcp.allowWrite.',
      permission: '*',
      write: true,
      inputSchema: { type: 'object', properties: { task: { type: 'string', maxLength: 200 } }, required: ['task'], additionalProperties: false },
      run: async (args) => services.scheduling().pause(args.task)
    },
    {
      name: 'scheduling.resume',
      description: 'Resumes a paused scheduled task. Write tool: needs mcp.allowWrite.',
      permission: '*',
      write: true,
      inputSchema: { type: 'object', properties: { task: { type: 'string', maxLength: 200 } }, required: ['task'], additionalProperties: false },
      run: async (args) => services.scheduling().resume(args.task)
    },
    {
      name: 'cache.delete',
      description: 'Deletes one cache entry. Write tool: needs mcp.allowWrite.',
      permission: '*',
      write: true,
      inputSchema: { type: 'object', properties: { key: { type: 'string', maxLength: 500 } }, required: ['key'], additionalProperties: false },
      run: async (args) => ({ key: args.key, deleted: await services.cache().delete(args.key) })
    },
    {
      name: 'settings.set',
      description: 'Sets one setting in a group. Write tool: needs mcp.allowWrite. The value is never returned.',
      permission: '*',
      write: true,
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string', maxLength: 200 }, group: { type: 'string', maxLength: 200 }, value: {} },
        required: ['key', 'value'],
        additionalProperties: false
      },
      run: async (args) => {
        await services.settings().set(args.key, args.value, args.group || 'default');
        return { key: args.key, group: args.group || 'default', saved: true };
      }
    }
  ];
}

/**
 * Builds the resources and prompts the server offers.
 * @param {Object} services Service accessors (see buildTools)
 * @param {Function} openApi Returns the merged OpenAPI document
 * @return {{resources: Array<Object>, prompts: Array<Object>, readResource: Function, getPrompt: Function}}
 */
function buildResourcesAndPrompts(services, openApi) {
  const resources = [
    { uri: 'nooblyjs://services', name: 'Services', description: 'Services and providers this app runs', mimeType: 'application/json' },
    { uri: 'nooblyjs://openapi', name: 'OpenAPI', description: 'Merged OpenAPI 3.1 document of the mounted services', mimeType: 'application/json' }
  ];
  const prompts = [
    {
      name: 'diagnose-failed-run',
      description: 'Walks through why a workflow execution failed, using the run and recent logs.',
      arguments: [{ name: 'executionId', description: 'Execution id of the failed run', required: true }]
    },
    {
      name: 'explain-service-config',
      description: 'Explains how the app is configured: services, providers and the auth model.',
      arguments: []
    }
  ];
  return {
    resources,
    prompts,
    readResource(uri) {
      if (uri === 'nooblyjs://services') return { mimeType: 'application/json', text: JSON.stringify(services.describe(), null, 2) };
      if (uri === 'nooblyjs://openapi') return { mimeType: 'application/json', text: JSON.stringify(openApi(), null, 2) };
      return null;
    },
    getPrompt(name, args = {}) {
      if (name === 'diagnose-failed-run') {
        const id = String(args.executionId || '');
        return {
          description: 'Diagnose a failed workflow run',
          messages: [{
            role: 'user',
            content: { type: 'text', text: `Use workflow.getRun with executionId "${id}" to read the status, failed step and error. Then use logs.recent (level "error") to find related entries. Explain the most likely cause and the smallest fix. Do not run write tools without asking.` }
          }]
        };
      }
      if (name === 'explain-service-config') {
        return {
          description: 'Explain the app configuration',
          messages: [{
            role: 'user',
            content: { type: 'text', text: 'Read nooblyjs://services, then explain which services and providers are running and what each one stores. Note which tools are read-only.' }
          }]
        };
      }
      return null;
    }
  };
}

/**
 * Creates the JSON-RPC handler for MCP messages.
 *
 * @param {Object} options
 * @param {Object} options.services Service accessors
 * @param {Function} options.openApi Returns the merged OpenAPI document
 * @param {boolean} [options.allowWrite=false] Whether write tools are listed and callable
 * @param {Function} options.resolvePrincipal Returns the caller's principal for a request
 * @param {Object} [options.eventEmitter] Emits `mcp:tool:called`
 * @return {{handle: Function, tools: Array<Object>}} `handle(message, req)` resolves to a response, or null for notifications
 */
function createMcpServer({ services, openApi, allowWrite = false, resolvePrincipal, eventEmitter = null }) {
  const allTools = buildTools(services);
  const tools = allTools.filter((t) => !t.write || allowWrite);
  const { resources, prompts, readResource, getPrompt } = buildResourcesAndPrompts(services, openApi);

  async function callTool(params, principal) {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return { error: fail(params.id, ERROR.INVALID_PARAMS, `Unknown tool "${params.name}"`) };
    const args = params.arguments ?? {};
    if (typeof args !== 'object' || Array.isArray(args)) {
      return { error: fail(params.id, ERROR.INVALID_PARAMS, 'arguments must be an object') };
    }
    const problem = schemaProblem(args, tool.inputSchema);
    if (problem) return { error: fail(params.id, ERROR.INVALID_PARAMS, problem) };

    const needsWildcard = tool.write || tool.permission === '*';
    const allowed = needsWildcard ? allows(principal, '*') : allows(principal, tool.permission);
    if (!allowed) {
      eventEmitter?.emit?.('mcp:tool:called', { principal: principal?.principal || null, tool: tool.name, outcome: 'denied' });
      return { result: { isError: true, content: [{ type: 'text', text: `Forbidden: ${tool.permission} is needed` }] } };
    }

    try {
      const value = await tool.run(args);
      const capped = capResult(value);
      eventEmitter?.emit?.('mcp:tool:called', { principal: principal?.principal || null, tool: tool.name, outcome: 'ok' });
      const plain = capped.value ?? null;
      return {
        result: {
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(plain) }],
          // MCP requires structuredContent to be a JSON object, so a list or
          // a single value is wrapped as { result }.
          structuredContent: isPlainObject(plain) ? plain : { result: plain },
          truncated: capped.truncated || undefined
        }
      };
    } catch (err) {
      eventEmitter?.emit?.('mcp:tool:called', { principal: principal?.principal || null, tool: tool.name, outcome: 'error' });
      const text = err instanceof ClientError ? err.message : 'The tool failed. See the server log.';
      return { result: { isError: true, content: [{ type: 'text', text }] } };
    }
  }

  /**
   * Handles one JSON-RPC message.
   * @param {Object} message Parsed JSON-RPC message
   * @param {Object} req Express request (for the caller's identity)
   * @return {Promise<Object|null>} Response, or null for a notification
   */
  async function handle(message, req) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return fail(message?.id, ERROR.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
    }
    const isNotification = message.id === undefined;
    const { id, method } = message;
    const params = message.params || {};

    if (isNotification) return null;

    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'NooblyJS app. Read tools inspect logs, queues, data, search, workflows and schedules. Write tools exist only when the operator enables them.'
      });
    }
    if (method === 'ping') return ok(id, {});

    const principal = await resolvePrincipal(req).catch(() => null);
    if (!principal) return fail(id, ERROR.INVALID_REQUEST, 'Sign in or send an API key');

    if (method === 'tools/list') {
      return ok(id, {
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: !t.write } }))
      });
    }
    if (method === 'tools/call') {
      const out = await callTool({ ...params, id }, principal);
      return out.error || ok(id, out.result);
    }
    if (method === 'resources/list') return ok(id, { resources });
    if (method === 'resources/read') {
      const found = readResource(params.uri);
      if (!found) return fail(id, ERROR.INVALID_PARAMS, `Unknown resource "${params.uri}"`);
      return ok(id, { contents: [{ uri: params.uri, mimeType: found.mimeType, text: found.text }] });
    }
    if (method === 'prompts/list') return ok(id, { prompts });
    if (method === 'prompts/get') {
      const found = getPrompt(params.name, params.arguments);
      if (!found) return fail(id, ERROR.INVALID_PARAMS, `Unknown prompt "${params.name}"`);
      return ok(id, found);
    }
    return fail(id, ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }

  return { handle, tools };
}

/**
 * Mounts the Streamable HTTP endpoint at `/services/mcp`.
 *
 * @param {Object} app Express app
 * @param {Object} options Same as createMcpServer
 * @return {{tools: Array<Object>}} The tools this endpoint lists
 */
function mountMcp(app, options) {
  const server = createMcpServer(options);

  app.post('/services/mcp', async (req, res) => {
    // Every message needs a signed-in caller, including tools/list: tool names are not public.
    const principal = options.resolvePrincipal ? await options.resolvePrincipal(req) : null;
    if (!principal) {
      res.set('WWW-Authenticate', 'ApiKey');
      return res.status(401).json(fail(null, ERROR.UNAUTHORIZED, 'Authentication required: send an API key or a personal access token'));
    }
    const body = req.body;
    if (body === undefined || body === null || typeof body !== 'object') {
      return res.status(400).json(fail(null, ERROR.PARSE, 'Body must be a JSON-RPC message or batch'));
    }
    try {
      if (Array.isArray(body)) {
        if (body.length === 0) return res.status(400).json(fail(null, ERROR.INVALID_REQUEST, 'Empty batch'));
        const replies = [];
        for (const message of body) {
          const reply = await server.handle(message, req);
          if (reply) replies.push(reply);
        }
        if (replies.length === 0) return res.status(202).end();
        return res.status(200).json(replies);
      }
      const reply = await server.handle(body, req);
      if (!reply) return res.status(202).end();
      return res.status(200).json(reply);
    } catch (_err) {
      return res.status(500).json(fail(body.id ?? null, ERROR.INTERNAL, 'Internal error'));
    }
  });

  // Streamable HTTP lets a client open an SSE stream here; this server does not push messages.
  app.get('/services/mcp', (req, res) => res.status(405).set('Allow', 'POST').end());

  return { tools: server.tools };
}

module.exports = {
  PROTOCOL_VERSION,
  createMcpServer,
  mountMcp,
  schemaProblem,
  capResult,
  grantsOf,
  allows
};
