/**
 * @fileoverview MCP over JSON-RPC 2.0 (feature 03): the methods an agent uses
 * to discover and call tools, read resources and get prompts. Transport-free:
 * the HTTP route and the stdio bridge both feed messages through handle().
 *
 * The protocol core lives here, in core, rather than in nooblyjs-ai-common as
 * the feature proposed, so the server does not wait on that package. Nothing
 * outside this module knows MCP's wire format.
 *
 * @module mcp/protocol
 */

'use strict';

/** Protocol revisions this server speaks, newest first. */
const PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26']);

/** JSON-RPC error codes. */
const ERROR = Object.freeze({
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603
});

/** Error that a server object throws to report bad params or an unknown name. */
class McpError extends Error {
  /**
   * @param {number} code JSON-RPC error code
   * @param {string} message Client-safe message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'McpError';
  }
}

/**
 * Builds a JSON-RPC response.
 * @param {*} id Request id
 * @param {*} result
 * @return {!Object}
 */
function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Builds a JSON-RPC error response.
 * @param {*} id
 * @param {number} code
 * @param {string} message
 * @return {!Object}
 */
function fail(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

/**
 * Handles one JSON-RPC message.
 *
 * @param {*} message A request, a notification, or a batch (array) of them.
 * @param {!Object} server Object with serverInfo, instructions and the
 *     methods listTools, callTool, listResources, readResource, listPrompts, getPrompt.
 * @return {Promise<?Object|Array<Object>>} The response, or null when the
 *     message was only notifications (the HTTP layer answers 202).
 */
async function handle(message, server) {
  if (Array.isArray(message)) {
    if (message.length === 0) return fail(null, ERROR.INVALID_REQUEST, 'Empty batch');
    const replies = [];
    for (const item of message) {
      const reply = await handleOne(item, server);
      if (reply) replies.push(reply);
    }
    return replies.length ? replies : null;
  }
  return handleOne(message, server);
}

/**
 * Handles a single request or notification.
 * @private
 */
async function handleOne(message, server) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return fail(null, ERROR.INVALID_REQUEST, 'A JSON-RPC message must be an object');
  }
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return fail(message.id, ERROR.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
  }
  const isNotification = message.id === undefined;
  const params = message.params && typeof message.params === 'object' ? message.params : {};

  try {
    const result = await dispatch(message.method, params, server);
    if (isNotification) return null;
    return ok(message.id, result);
  } catch (error) {
    if (isNotification) return null;
    if (error instanceof McpError) return fail(message.id, error.code, error.message);
    return fail(message.id, ERROR.INTERNAL, 'The server could not complete the request');
  }
}

/**
 * Runs one MCP method.
 * @private
 */
async function dispatch(method, params, server) {
  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : null;
      const version = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: server.serverInfo,
        instructions: server.instructions
      };
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return {};
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: await server.listTools() };
    case 'tools/call': {
      if (typeof params.name !== 'string') throw new McpError(ERROR.INVALID_PARAMS, 'tools/call needs a tool name');
      return server.callTool(params.name, params.arguments);
    }
    case 'resources/list':
      return { resources: await server.listResources() };
    case 'resources/read': {
      if (typeof params.uri !== 'string') throw new McpError(ERROR.INVALID_PARAMS, 'resources/read needs a uri');
      return { contents: [await server.readResource(params.uri)] };
    }
    case 'prompts/list':
      return { prompts: await server.listPrompts() };
    case 'prompts/get': {
      if (typeof params.name !== 'string') throw new McpError(ERROR.INVALID_PARAMS, 'prompts/get needs a prompt name');
      return server.getPrompt(params.name, params.arguments || {});
    }
    default:
      throw new McpError(ERROR.METHOD_NOT_FOUND, `Unknown method "${method}"`);
  }
}

module.exports = { handle, McpError, ERROR, PROTOCOL_VERSIONS, ok, fail };
