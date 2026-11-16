'use strict';
// Example 17: the MCP endpoint: how a coding agent reads and drives a running app.
const { registry, call, serve, done } = require('./setup');

/**
 * Sends one JSON-RPC message to the MCP endpoint, as an agent would.
 * @param {string} method JSON-RPC method, such as tools/list or tools/call
 * @param {Object=} params Method parameters
 * @param {number} id Request id
 * @return {Promise<{status: number, body: *}>}
 */
function rpc(method, params, id) {
  return call('POST', '/services/mcp', { jsonrpc: '2.0', id, method, params });
}

(async () => {
  // Some data for the agent to look at.
  const queue = registry.queue('memory');
  registry.logger('memory');
  await queue.enqueue('emails', { to: 'ada@example.com' });
  await queue.enqueue('emails', { to: 'grace@example.com' });

  // The endpoint is mounted because 'mcp.enabled' is set in setup.js.
  // Every call needs a caller: here, the learning API key.

  // 1. The agent lists the tools it may use. Only tools whose REST route the
  //    caller may use are listed.
  const tools = await rpc('tools/list', {}, 1);
  const names = tools.body.result.tools.map((tool) => tool.name);
  console.log('tools', names.join(', '));

  // 2. The agent calls a tool: here, the queue statistics.
  const stats = await rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'emails' } }, 2);
  console.log('queue.stats', JSON.stringify(stats.body.result?.structuredContent ?? stats.body).slice(0, 200));

  // 3. Without a caller the endpoint refuses the message.
  const anonymous = await fetch(`${await serve()}/services/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
  });
  console.log('anonymous', anonymous.status);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
