/**
 * @fileoverview `nooblyjs mcp --url <base>`: a stdio bridge for coding agents
 * (feature 03). The agent starts this command and speaks MCP over stdin and
 * stdout; each message is forwarded to the running app's `/services/api/mcp`.
 *
 * The bridge does not decide what is allowed. Write tools depend on the app's
 * `mcp.allowWrite` setting and on the key's permissions.
 *
 * @module cli/commands/mcp
 */

'use strict';

const readline = require('node:readline');
const { ERROR } = require('../../mcp/protocol');

/**
 * An error reply for a request that has an id. Notifications get no reply.
 * @param {*} message The request
 * @param {string} text Client-safe message
 * @return {?string}
 */
function replyError(message, text) {
  if (!message || typeof message !== 'object' || message.id === undefined) return null;
  return JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: ERROR.INTERNAL, message: text } });
}

/**
 * Forwards one line of JSON-RPC and returns the line to write back (or null).
 * @param {string} line
 * @param {Object} io
 * @param {string} endpoint
 * @param {string=} key
 * @return {Promise<?string>}
 */
async function forward(line, io, endpoint, key) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: ERROR.PARSE, message: 'Parse error' } });
  }
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (key) headers['x-api-key'] = key;
  try {
    const res = await io.fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(message) });
    if (res.status === 202) return null;
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try { detail = JSON.parse(text).error || text; } catch { /* keep the text */ }
      return replyError(message, `The app answered ${res.status}: ${String(detail).slice(0, 200)}`);
    }
    return text;
  } catch (error) {
    return replyError(message, `Could not reach the app: ${error.message}`);
  }
}

module.exports = {
  forward,
  /**
   * @param {Array<string>} argv
   * @param {Object} io
   * @param {Function} parseArgs
   * @return {Promise<number>}
   */
  async run(argv, io, parseArgs) {
    const { values } = parseArgs({
      args: argv,
      options: { url: { type: 'string' }, key: { type: 'string' } },
      allowPositionals: false
    });
    if (!values.url) {
      io.stderr.write('Usage: nooblyjs mcp --url <base-url> [--key <api-key>]\n');
      return 2;
    }
    const endpoint = `${values.url.replace(/\/$/, '')}/services/api/mcp`;
    const key = values.key || io.env.NOOBLYJS_API_KEY;
    // Read whole lines: one JSON-RPC message per line.
    const lines = readline.createInterface({ input: io.stdin, crlfDelay: Infinity });
    for await (const raw of lines) {
      const line = String(raw).trim();
      if (!line) continue;
      const reply = await forward(line, io, endpoint, key);
      if (reply) io.stdout.write(`${reply}\n`);
    }
    return 0;
  }
};
