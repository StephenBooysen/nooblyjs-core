'use strict';

/**
 * Shared setup for the learning examples.
 *
 * Every example in this folder starts with this file. It creates one Express
 * app, initializes the service registry with the settings a learner needs, and
 * gives each example a server and a `call()` helper for the REST routes.
 *
 * Run any example from the repository root, for example:
 *   node .claude/learning/examples/01-logging.js
 *
 * The settings below are for learning on your own machine only. Production
 * settings are in README.md ("Configuration" and "Security").
 *
 * @module learning/examples/setup
 */

const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const express = require('express');
const registry = require('../../../index');

/** Repository root, resolved from this file. */
const root = path.resolve(__dirname, '..', '..', '..');

/** Every example writes its files and logs under here (git-ignored). */
const dataDir = path.join(root, '.temp', 'learning');

/** The API key the examples send. Local learning only. */
const API_KEY = 'learning-key';

const app = express();
app.use(express.json());
const eventEmitter = new EventEmitter();

registry.initialize(app, eventEmitter, {
  security: {
    // Dashboard sign-in is not needed for the examples.
    servicesAuth: { requireLogin: false },
    // Every /services/*/api call must carry this key (the production default).
    apiKeyAuth: { apiKeys: [API_KEY], requireApiKey: true },
  },
  // Enables the MCP endpoint, used by the MCP example.
  mcp: { enabled: true, allowWrite: true },
  // Tracing is off unless you turn it on; the telemetry example shows how.
});

let server = null;
let baseUrl = null;

/**
 * Starts the example server on a free local port. Call once per example.
 * @return {Promise<string>} The base URL, for example http://127.0.0.1:41234
 */
async function serve() {
  if (server) return baseUrl;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

/**
 * Calls a REST route of the running example server with the learning API key.
 * @param {string} method HTTP method
 * @param {string} urlPath Path such as /services/caching/api/get/greeting
 * @param {*=} body JSON body
 * @return {Promise<{status: number, body: *}>} Status and parsed body (text when not JSON)
 */
async function call(method, urlPath, body) {
  const base = await serve();
  const response = await fetch(base + urlPath, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    // Not JSON: keep the text.
  }
  return { status: response.status, body: parsed };
}

/**
 * Stops the example server and exits. Every example ends with this so that
 * the process does not wait on open handles.
 * @return {void}
 */
function done() {
  if (server) server.close();
  process.exit(0);
}

module.exports = { registry, app, eventEmitter, root, dataDir, serve, call, done, API_KEY };
