/**
 * @fileoverview MCP demo (feature 03). A small app with the MCP endpoint on, so
 * a coding agent can read its logs, queues, caches and monitoring snapshot.
 *
 * Run: node tests/app/mcp/app-mcp.js
 *
 * Connect Claude Code (the printed command does this):
 *   claude mcp add nooblyjs -- npx nooblyjs mcp --url http://localhost:9150
 *   export NOOBLYJS_API_KEY=<the key printed at start-up>
 *
 * Write tools (queue purge, schedule pause, ...) stay off. Set MCP_ALLOW_WRITE=1
 * to enable them; they need an admin credential.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const express = require('express');
const path = require('node:path');
const EventEmitter = require('events');
const serviceRegistry = require('../../../index');
const { generateApiKey } = serviceRegistry;

const PORT = Number(process.env.PORT || 9150);
const apiKey = process.env.NOOBLYJS_API_KEY || generateApiKey(32);

const app = express();
app.use(express.json());

const eventEmitter = new EventEmitter();
serviceRegistry.initialize(app, eventEmitter, {
  logDir: path.join(__dirname, '.application', 'logs'),
  dataDir: path.join(__dirname, '.application', 'data'),
  cacheDir: path.join(__dirname, '.application', 'caching'),
  'express-app': app,
  brandingConfig: { appName: 'MCP Demo', primaryColor: '#000' },
  security: {
    apiKeyAuth: { requireApiKey: true, apiKeys: [apiKey] },
    servicesAuth: { requireLogin: false }
  },
  mcp: { enabled: true, allowWrite: process.env.MCP_ALLOW_WRITE === '1' }
});

// Services the MCP tools read from. Created so there is something to see.
serviceRegistry.logger();
const cache = serviceRegistry.cache();
serviceRegistry.queue();
cache.put('demo:started', { at: new Date().toISOString() }, 600);

app.listen(PORT, () => {
  console.log(`MCP demo on http://localhost:${PORT}`);
  console.log(`API key: ${apiKey}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/services/mcp`);
  console.log(`Connect Claude Code:\n  claude mcp add nooblyjs -- npx nooblyjs mcp --url http://localhost:${PORT}`);
});
