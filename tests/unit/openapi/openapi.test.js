/**
 * @fileoverview The merged OpenAPI 3.1 document (feature 10): structure, resolved
 * references, the /services/api/openapi.json endpoint, and a drift check between
 * the documents and the routes Express registers.
 *
 * The drift check: every route Express registers must have a documented
 * operation in its service's `routes/swagger/docs.json`, and every documented
 * operation must have a route. `undocumentedRoutes.baseline.json` lists
 * exceptions; it is empty, and the test fails when a route is added without
 * documentation.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const registry = require('../../../index');
const { listApiRoutes } = require('../../../src/authservice/modules/routeDeclarations');
const om = require('../../../src/shared/utils/openapi');
const { testDataDir } = require('../../helpers/testData');

const SRC = path.join(__dirname, '..', '..', '..', 'src');
const BASELINE = path.join(__dirname, 'undocumentedRoutes.baseline.json');

/** Collects every local `$ref` in a document. */
function collectRefs(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

describe('merged OpenAPI document (feature 10)', () => {
  let app;
  let services;
  let routes;

  beforeAll(() => {
    const dir = testDataDir('openapi');
    app = express();
    registry.initialize(app, new EventEmitter(), { apiKeys: ['k'], security: { servicesAuth: { requireLogin: false } } });
    registry.logger('memory'); registry.cache('memory'); registry.fetching('node');
    registry.filing('local', { baseDir: path.join(dir, 'files') }); registry.queue('memory');
    registry.scheduling('memory'); registry.searching('memory'); registry.measuring('memory');
    registry.notifying('memory'); registry.working('memory'); registry.workflow('memory');
    registry.settings('file', { filepath: path.join(dir, 'settings.json'), secret: 'x'.repeat(32) });
    registry.aiservice('mock', {}); registry.authservice('memory', {}); registry.dataService('memory');
    registry.knowledge('default', { container: 'openapi-kb', persist: false, dependencies: { aiservice: registry.aiservice('mock', {}) } });
    // Only services this app has mounted are part of it, as in the merged document.
    const mounted = om.mountedBases(app);
    services = om.loadServiceDocuments(SRC).filter((s) => mounted.has(om.serviceBase(s.doc, s.dir)));
    routes = listApiRoutes(app);
  });

  afterAll(async () => { await registry.shutdown?.(); registry.reset?.(); });

  it('is OpenAPI 3.1 with one server, service tags and absolute paths', () => {
    const doc = registry.buildOpenApi();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('NooblyJS Core API');
    expect(doc.tags.map((t) => t.name)).toEqual(expect.arrayContaining(['Caching', 'Queueing', 'Filing']));
    for (const p of Object.keys(doc.paths)) expect(p.startsWith('/')).toBe(true);
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/services/caching/api/'))).toBe(true);
  });

  it('tags every operation with its service and gives each operation a unique id', () => {
    const doc = registry.buildOpenApi();
    const ids = [];
    for (const item of Object.values(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!['get', 'put', 'post', 'delete', 'patch'].includes(method)) continue;
        expect(op.tags).toHaveLength(1);
        ids.push(op.operationId);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every $ref to a component that exists', () => {
    const doc = registry.buildOpenApi();
    for (const ref of collectRefs(doc)) {
      const m = ref.match(/^#\/components\/(\w+)\/(.+)$/);
      expect(m).not.toBeNull();
      const group = doc.components?.[m[1]] || {};
      expect(Object.prototype.hasOwnProperty.call(group, m[2])).toBe(true);
    }
  });

  it('uses one name per security scheme', () => {
    const doc = registry.buildOpenApi();
    const names = new Set();
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item)) {
        for (const req of op.security || []) Object.keys(req).forEach((n) => names.add(n));
      }
    }
    for (const n of names) expect(['ApiKeyAuth', 'BearerAuth', 'SessionCookie']).toContain(n);
    expect(Object.keys(doc.components.securitySchemes)).toEqual(expect.arrayContaining(['ApiKeyAuth', 'BearerAuth', 'SessionCookie']));
  });

  it('serves the document at /services/api/openapi.json', async () => {
    const res = await request(app).get('/services/api/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/services/queueing/api/queues/{queueName}/jobs']).toBeDefined();
  });

  it('serves the same document as YAML at /services/api/openapi.yaml', async () => {
    const res = await request(app).get('/services/api/openapi.yaml').expect(200);
    expect(res.headers['content-type']).toMatch(/yaml/);
    const parsed = require('js-yaml').load(res.text);
    expect(parsed.openapi).toBe('3.1.0');
    expect(Object.keys(parsed.paths)).toEqual(Object.keys(registry.buildOpenApi().paths));
  });

  it('documents only routes that exist', () => {
    expect(om.routelessDocumentation(routes, services)).toEqual([]);
  });

  it('documents every route, except the baselined ones', () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const current = om.undocumentedRoutes(routes, services);
    const added = current.filter((k) => !baseline.includes(k));
    const documentedNow = baseline.filter((k) => !current.includes(k));
    expect({ added, documentedNow }).toEqual({ added: [], documentedNow: [] });
  });

  it('describes every built-in route: the merged document has no generated stubs', () => {
    const doc = registry.buildOpenApi();
    const stubs = [];
    for (const [p, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) if (op['x-undocumented']) stubs.push(`${method.toUpperCase()} ${p}`);
    }
    expect(stubs).toEqual([]);
  });

  it('gives an app route with no documentation a marked stub that keeps its permission and input', () => {
    const doc = om.buildOpenApiDocument({
      services: [],
      routes: [{
        method: 'POST',
        pattern: '/services/orders/api/orders/:id',
        permission: 'orders:write',
        schema: { body: { note: { type: 'string', required: true, maxLength: 200 } } }
      }]
    });
    const op = doc.paths['/services/orders/api/orders/{id}'].post;
    expect(op).toEqual(expect.objectContaining({ 'x-undocumented': true, 'x-permission': 'orders:write', tags: ['Orders'] }));
    expect(op.summary).toBeTruthy();
    expect(op.responses).toBeDefined();
    expect(op.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true })]);
    expect(op.requestBody.content['application/json'].schema).toEqual(expect.objectContaining({ required: ['note'] }));
  });
});
