/**
 * @fileoverview The MCP endpoint (feature 03): JSON-RPC over HTTP POST at
 * `/services/api/mcp`. Mounted only when `mcp.enabled` is true.
 *
 * Access: the route needs the `mcp:use` permission (administrators and
 * administrator keys have it). Write tools also need the caller to be an
 * administrator or to hold an unscoped key, and `mcp.allowWrite` to be set.
 *
 * @module mcp/routes
 */

'use strict';

const { handle } = require('./protocol');
const { createServer } = require('./server');

/**
 * Who is calling, from what the auth middleware attached to the request.
 * @param {!Object} req
 * @return {{roles: Array<string>, admin: boolean, canWrite: boolean, actor: string}}
 */
function callerOf(req) {
  const roles = Array.isArray(req.user?.roles)
    ? req.user.roles.map(String)
    : (Array.isArray(req.userRoles) ? req.userRoles.map(String) : []);
  const admin = roles.includes('admin');
  // A static key with no scopes has full access, like an administrator.
  const unscopedKey = Boolean(req.apiKey) && !req.apiKeyScopes;
  let actor = 'anonymous';
  if (req.user?.email) actor = req.user.email;
  else if (req.userEmail) actor = req.userEmail;
  else if (req.apiKey) actor = `api key ${String(req.apiKey).slice(0, 8)}…`;
  return { roles, admin, canWrite: admin || unscopedKey, actor };
}

/**
 * Mounts the MCP endpoint.
 *
 * @param {!Object} app Express application
 * @param {Object} input
 * @param {Object} input.registry Service registry (its `services` map holds the instances)
 * @param {EventEmitter=} input.eventEmitter Receives `mcp:tool:called`
 * @param {{enabled: boolean, allowWrite?: boolean}} input.config The `mcp` option
 * @param {{name: string, version: string}} input.serverInfo
 * @return {void}
 */
function mountMcpRoutes(app, { registry, eventEmitter, config = {}, serverInfo }) {
  app.post('/services/api/mcp', async (req, res) => {
    const caller = callerOf(req);
    const server = createServer({
      services: registry.services,
      serverInfo,
      allowWrite: config.allowWrite === true,
      canWrite: caller.canWrite,
      admin: caller.admin,
      roles: caller.roles,
      actor: caller.actor,
      eventEmitter,
      app,
      registry
    });
    const reply = await handle(req.body, server);
    if (reply === null) return res.status(202).end();
    res.status(200).json(reply);
  });

  app.get('/services/api/mcp', (req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'Send MCP messages with POST. This server does not open a server-sent stream.' });
  });
}

module.exports = { mountMcpRoutes, callerOf };
