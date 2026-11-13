'use strict';

// A NooblyJS app with the service dashboards. Sign-in is required: /services/*
// needs an authenticated admin session (the registry's default).
const path = require('node:path');
const { EventEmitter } = require('node:events');
const express = require('express');
const registry = require('nooblyjs-core');

const isProduction = process.env.NODE_ENV === 'production';
const apiKeys = (process.env.API_KEYS || process.env.NOOBLYJS_API_KEYS || '')
  .split(',').map((k) => k.trim()).filter(Boolean);
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('Set SESSION_SECRET (32+ characters) before starting in production.');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const eventEmitter = new EventEmitter();
registry.initialize(app, eventEmitter, {
  logDir: path.join(__dirname, '.application', 'logs'),
  dataDir: path.join(__dirname, '.application', 'data'),
  apiKeys,
  requireApiKey: apiKeys.length > 0,
  excludePaths: ['/health', '/services/*/status'],
  security: { servicesAuth: { requireLogin: true } }
});

registry.authservice();
registry.logger('memory');
registry.cache('memory');
registry.queue('memory');
registry.dataService('memory');

const port = Number(process.env.PORT) || 9000;
if (require.main === module) {
  app.listen(port, () => console.log(`dashboards on http://localhost:${port}/services/`));
}

module.exports = { app, registry };
