'use strict';

// A NooblyJS app that answers questions from the Markdown files in ./docs, with
// citations. Uses Claude when ANTHROPIC_API_KEY is set, and a mock model otherwise.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const express = require('express');
const registry = require('nooblyjs-core');

const isProduction = process.env.NODE_ENV === 'production';
const configured = (process.env.API_KEYS || process.env.NOOBLYJS_API_KEYS || '')
  .split(',').map((k) => k.trim()).filter(Boolean);
if (configured.length === 0 && isProduction) {
  console.error('Set API_KEYS (comma-separated) before starting in production.');
  process.exit(1);
}
// The knowledge routes sit behind the services login, so an API key is always
// needed. Outside production, a key is generated and printed when none is set.
const apiKeys = configured.length ? configured : [registry.generateApiKey(32)];
if (configured.length === 0) console.log(`No API_KEYS set. Development key: ${apiKeys[0]}`);

const app = express();
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const eventEmitter = new EventEmitter();
registry.initialize(app, eventEmitter, {
  logDir: path.join(__dirname, '.application', 'logs'),
  dataDir: path.join(__dirname, '.application', 'data'),
  apiKeys,
  requireApiKey: true,
  excludePaths: ['/health', '/services/*/status']
});

registry.logger('memory');
registry.queue('memory');

const filing = registry.filing('local', { baseDir: path.join(__dirname, 'docs') });
const ai = process.env.ANTHROPIC_API_KEY
  ? registry.aiservice('claude', { apiKey: process.env.ANTHROPIC_API_KEY })
  : registry.aiservice('mock', {});
const knowledge = registry.knowledge('default', { dependencies: { filing, aiservice: ai } });

// Index the docs once at start-up. Tests and callers can await `ready`.
const ready = knowledge.sync({ directory: '.' }).catch((err) => {
  console.error('Could not index ./docs:', err.message);
});

const port = Number(process.env.PORT) || 9000;
if (require.main === module) {
  ready.then(() => app.listen(port, () => console.log(`ask your docs on http://localhost:${port}/services/knowledge/api/ask`)));
}

module.exports = { app, registry, knowledge, ready, apiKeys };
