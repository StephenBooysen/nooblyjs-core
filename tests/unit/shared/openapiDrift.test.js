/**
 * @fileoverview Drift test for the OpenAPI document (feature 10). Boots the
 * registry with the services app.js wires, then checks that:
 *
 * - every documented operation still matches a mounted route (no stale docs);
 * - every mounted API route appears in the merged document;
 * - the merged document validates against the OpenAPI 3.1 schema;
 * - the endpoints serve it to a caller with a key, and refuse an anonymous one.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const SwaggerParser = require('@apidevtools/swagger-parser');
const { EventEmitter } = require('events');

const serviceRegistry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');
const { buildOpenApiDocument, listApiRoutes, loadServiceDocs, canonicalPath } = require('../../../src/shared/utils/openapi');

const API_KEY = 'openapi-drift-key-0123456789abcdef0123456789';

describe('OpenAPI drift (feature 10)', () => {
  let workDir;
  let app;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(testDataDir('openapi'), 'drift-'));
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    serviceRegistry.reset();
    app = express();
    app.use(express.json());
    serviceRegistry.initialize(app, new EventEmitter(), {
      logDir: path.join(workDir, 'logs'),
      dataDir: path.join(workDir, 'data'),
      security: {
        apiKeyAuth: { apiKeys: [API_KEY], requireApiKey: true, excludePaths: ['/services/*/status', '/services/'] },
        servicesAuth: { requireLogin: false }
      }
    });
    serviceRegistry.logger('memory');
    serviceRegistry.cache('memory');
    serviceRegistry.dataService('memory');
    serviceRegistry.filing('local', { baseDir: path.join(workDir, 'files') });
    serviceRegistry.queue('memory');
    serviceRegistry.scheduling('memory');
    serviceRegistry.searching('memory');
    serviceRegistry.measuring('memory');
    serviceRegistry.notifying('memory');
    serviceRegistry.working('memory', { activitiesFolder: path.join(workDir, 'activities') });
    serviceRegistry.workflow('memory');
    serviceRegistry.fetching('node');
    serviceRegistry.authservice('memory');
    serviceRegistry.settings('file', { filepath: path.join(workDir, 'settings', 'settings.enc.json'), secret: 'openapi-drift-secret-0123456789' });
    serviceRegistry.aiservice('mock', {});
  });

  afterEach(() => {
    serviceRegistry.reset();
  });

  it('has no documented operation without a mounted route', () => {
    const { stale, documented } = buildOpenApiDocument({ routes: listApiRoutes(app), docs: loadServiceDocs() });
    expect(stale).toEqual([]);
    expect(documented).toBeGreaterThan(100);
  });

  it('lists every mounted API route in the merged document', () => {
    const routes = listApiRoutes(app);
    const { document } = buildOpenApiDocument({ routes, docs: loadServiceDocs() });
    const inDocument = new Set();
    for (const [p, item] of Object.entries(document.paths)) {
      for (const method of Object.keys(item)) inDocument.add(`${method.toUpperCase()} ${canonicalPath(p)}`);
    }
    const missing = routes
      .map((r) => `${r.method} ${canonicalPath(r.path)}`)
      .filter((key) => !inDocument.has(key));
    expect(missing).toEqual([]);
  });

  it('validates against the OpenAPI 3.1 schema', async () => {
    const { document } = buildOpenApiDocument({ routes: listApiRoutes(app), docs: loadServiceDocs() });
    await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(document)))).resolves.toBeDefined();
  });

  it('serves the JSON document to a caller with a key, and refuses an anonymous one', async () => {
    const anonymous = await request(app).get('/services/api/openapi.json');
    expect(anonymous.status).toBeGreaterThanOrEqual(401);
    expect(anonymous.status).toBeLessThan(500);

    const res = await request(app).get('/services/api/openapi.json').set('x-api-key', API_KEY).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(200);
  });

  it('serves the same document as YAML and the reference page with its script', async () => {
    const yaml = await request(app).get('/services/api/openapi.yaml').set('x-api-key', API_KEY).expect(200);
    expect(yaml.text).toMatch(/^openapi: "3\.1\.0"/m);

    const page = await request(app).get('/services/api/docs').set('x-api-key', API_KEY).expect(200);
    expect(page.text).toContain('<script src="/services/api/docs/app.js"></script>');
    expect(page.text).not.toMatch(/<script>(?!\s*<\/script>)/);

    const script = await request(app).get('/services/api/docs/app.js').set('x-api-key', API_KEY).expect(200);
    expect(script.text).toContain('/services/api/openapi.json');
  });
});
