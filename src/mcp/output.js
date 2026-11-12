/**
 * @fileoverview Result handling for MCP tools (feature 03): secrets are
 * redacted before anything reaches an agent, and results are capped in size.
 *
 * @module mcp/output
 */

'use strict';

/** Largest result text a tool may return. */
const MAX_RESULT_CHARS = 64 * 1024;

/** Keys whose values are never shown to an agent. */
const SECRET_KEY = /secret|password|passwd|token|api[-_]?key|authorization|cookie|credential|private[-_]?key/i;

/**
 * Returns a copy of a value with secret-looking keys masked, at any depth.
 * @param {*} value
 * @param {number=} depth
 * @return {*}
 */
function redact(value, depth = 0) {
  if (depth > 20) return '[depth limit]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Turns a tool's return value into MCP text content, redacted and capped.
 * @param {*} result
 * @return {{type: string, text: string}}
 */
function toContent(result) {
  let text = JSON.stringify(redact(result === undefined ? null : result), null, 2) ?? 'null';
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n… truncated at ${MAX_RESULT_CHARS} characters; ask for fewer items`;
  }
  return { type: 'text', text };
}

module.exports = { redact, toContent, MAX_RESULT_CHARS };
