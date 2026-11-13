/**
 * @fileoverview `nooblyjs routes` and `nooblyjs openapi`: read the OpenAPI document
 * of a running app (feature 09 / 10). Auth comes from NOOBLYJS_API_KEY or
 * NOOBLYJS_TOKEN.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./index');
const { generateTypeScriptClient } = require('./tsClient');

const DEFAULT_URL = 'http://localhost:9000';

/**
 * Builds the request headers from the environment.
 * @param {Object} env Environment
 * @return {Object} Headers
 */
function authHeaders(env) {
  const headers = { accept: 'application/json' };
  if (env.NOOBLYJS_API_KEY) headers['x-api-key'] = env.NOOBLYJS_API_KEY;
  if (env.NOOBLYJS_TOKEN) headers.authorization = `Bearer ${env.NOOBLYJS_TOKEN}`;
  return headers;
}

/**
 * Downloads the merged OpenAPI document of a running app.
 * @param {string} baseUrl App base URL
 * @param {Object} io Environment and fetch
 * @return {Promise<Object>} OpenAPI document
 * @throws {Error} When the app cannot be reached or refuses the request
 */
async function fetchDocument(baseUrl, io) {
  const fetchFn = io.fetch || globalThis.fetch;
  const url = `${baseUrl.replace(/\/$/, '')}/services/api/openapi.json`;
  let res;
  try {
    res = await fetchFn(url, { headers: authHeaders(io.env) });
  } catch (error) {
    throw new Error(`cannot reach ${url}: ${error.message}`);
  }
  if (!res.ok) throw new Error(`${url} answered ${res.status}; set NOOBLYJS_API_KEY or NOOBLYJS_TOKEN`);
  return res.json();
}

/**
 * Runs `nooblyjs routes [--url <url>]`.
 * @param {string[]} args Arguments after `routes`
 * @param {Object} io Streams, environment and fetch
 * @return {Promise<number>} Exit code
 */
async function routes(args, io) {
  const { values } = parse(args, { url: { type: 'string' } });
  const doc = await fetchDocument(values.url || io.env.NOOBLYJS_URL || DEFAULT_URL, io);
  const rows = [];
  for (const [route, item] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'put', 'post', 'delete', 'patch', 'head', 'options'].includes(method)) continue;
      const tag = (op.tags && op.tags[0]) || '';
      const schemes = (op.security || []).flatMap((req) => Object.keys(req));
      const auth = schemes.length ? schemes.join('|') : 'none declared';
      rows.push(`${method.toUpperCase().padEnd(7)} ${route.padEnd(70)} ${tag.padEnd(12)} ${auth}`);
    }
  }
  io.stdout.write(`${rows.join('\n')}\n${rows.length} operation(s)\n`);
  return 0;
}

/**
 * Runs `nooblyjs openapi [--url] [--out <file>] [--client ts]`.
 * Without --out the document or client is printed to stdout.
 *
 * @param {string[]} args Arguments after `openapi`
 * @param {Object} io Streams, environment, fetch and cwd
 * @return {Promise<number>} Exit code
 */
async function openapi(args, io) {
  const { values } = parse(args, {
    url: { type: 'string' },
    out: { type: 'string' },
    client: { type: 'string' }
  });
  if (values.client && values.client !== 'ts') {
    io.stderr.write('--client supports only "ts" here. Other languages: openapi-generator with the written document.\n');
    return 2;
  }
  const doc = await fetchDocument(values.url || io.env.NOOBLYJS_URL || DEFAULT_URL, io);
  const text = values.client === 'ts' ? generateTypeScriptClient(doc) : `${JSON.stringify(doc, null, 2)}\n`;
  if (values.out) {
    const target = path.resolve(io.cwd || process.cwd(), values.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    io.stdout.write(`wrote ${target}\n`);
  } else {
    io.stdout.write(text);
  }
  return 0;
}

module.exports = { routes, openapi, fetchDocument, authHeaders, DEFAULT_URL };
