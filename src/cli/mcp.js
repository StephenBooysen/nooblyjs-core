/**
 * @fileoverview `nooblyjs mcp`: a stdio bridge to a running app's MCP endpoint
 * (feature 03). Each JSON-RPC line on stdin is posted to `/services/mcp`, and the
 * answer is written back as one line on stdout. Use it in an agent's MCP config:
 *   { "command": "npx", "args": ["nooblyjs", "mcp", "--url", "http://localhost:9000"],
 *     "env": { "NOOBLYJS_TOKEN": "..." } }
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const readline = require('node:readline');
const { parse } = require('./index');
const { authHeaders, DEFAULT_URL } = require('./remote');

/**
 * Runs the bridge until stdin closes.
 * @param {string[]} args Arguments after `mcp`
 * @param {Object} io Streams (stdin, stdout), environment and fetch
 * @return {Promise<number>} Exit code
 */
async function run(args, io) {
  const { values } = parse(args, { url: { type: 'string' } });
  const endpoint = `${(values.url || io.env.NOOBLYJS_URL || DEFAULT_URL).replace(/\/$/, '')}/services/mcp`;
  const fetchFn = io.fetch || globalThis.fetch;
  const headers = { ...authHeaders(io.env), 'content-type': 'application/json' };
  const rl = readline.createInterface({ input: io.stdin || process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (_err) {
      io.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }
    try {
      const res = await fetchFn(endpoint, { method: 'POST', headers, body: JSON.stringify(message) });
      if (res.status === 202) continue;
      const text = (await res.text()).trim();
      if (text) io.stdout.write(`${text}\n`);
    } catch (error) {
      if (message && message.id !== undefined) {
        io.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: `App unreachable at ${endpoint}: ${error.message}` } })}\n`);
      }
    }
  }
  return 0;
}

module.exports = { run };
