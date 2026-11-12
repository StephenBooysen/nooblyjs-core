/**
 * @fileoverview HTTP routes for the merged OpenAPI document (feature 10):
 *   GET /services/api/openapi.json  – the document
 *   GET /services/api/openapi.yaml  – the same document as YAML
 *   GET /services/api/docs          – an API reference page (local assets, CSP-safe)
 *   GET /services/api/docs/app.js   – the page's script
 *
 * The document is built from the routes mounted at request time and cached
 * until the number of routes changes.
 *
 * @module shared/utils/openapiRoutes
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildOpenApiDocument,
  listApiRoutes,
  loadServiceDocs,
  toYaml
} = require('./openapi');

const SCRIPT_PATH = path.join(__dirname, '..', 'views', 'openapi-docs.js');

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NooblyJS API reference</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="/services/css/styles.css">
</head>
<body class="p-3">
  <main class="container-lg">
    <header class="mb-3">
      <h1 class="h3">NooblyJS API reference</h1>
      <p class="text-muted mb-2">Every API route this app mounts. Download the
        <a href="/services/api/openapi.json">OpenAPI JSON</a> or
        <a href="/services/api/openapi.yaml">YAML</a>.</p>
      <p id="api-status" class="small text-muted">Loading…</p>
      <input id="api-filter" class="form-control" type="search" placeholder="Filter by path, method, service or summary" aria-label="Filter operations">
    </header>
    <div id="api-list"></div>
  </main>
  <script src="/services/api/docs/app.js"></script>
</body>
</html>
`;

/**
 * Mounts the OpenAPI routes on an Express app.
 *
 * @param {!Object} app Express application
 * @param {Object=} options
 * @param {string=} options.version App version shown in the document
 * @param {Object=} options.eventEmitter Receives `api-openapi-served`
 * @return {void}
 */
function mountOpenApiRoutes(app, { version = '0.0.0', eventEmitter } = {}) {
  let cache = { key: null, value: null };
  const docs = loadServiceDocs();

  const build = () => {
    const routes = listApiRoutes(app);
    const key = `${routes.length}`;
    if (cache.key !== key) {
      cache = { key, value: buildOpenApiDocument({ routes, docs, version }) };
    }
    return cache.value;
  };

  app.get('/services/api/openapi.json', (req, res) => {
    const { document } = build();
    eventEmitter?.emit('api-openapi-served', { format: 'json' });
    res.status(200).type('application/json').send(JSON.stringify(document, null, 2));
  });

  app.get('/services/api/openapi.yaml', (req, res) => {
    const { document } = build();
    eventEmitter?.emit('api-openapi-served', { format: 'yaml' });
    res.status(200).type('text/yaml').send(`${toYaml(document)}\n`);
  });

  app.get('/services/api/docs', (req, res) => {
    res.status(200).type('text/html').send(PAGE);
  });

  app.get('/services/api/docs/app.js', (req, res) => {
    res.status(200).type('application/javascript').send(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  });
}

module.exports = { mountOpenApiRoutes };
