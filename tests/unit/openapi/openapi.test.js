/**
 * @fileoverview The merged OpenAPI 3.1 document (feature 10): structure, resolved
 * references, the /services/api/openapi.json endpoint, and a drift check between
 * the documents and the routes Express registers.
 *
 * The drift check is a ratchet. Routes that have no documented operation are
 * listed in `undocumentedRoutes.baseline.json`. The test fails when a new route
 * is added without documentation, and when a baselined route gets documented
 * (remove it from the list then). The list only shrinks.
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

  it('marks generated stubs for undocumented routes and keeps permissions on them', () => {
    const doc = registry.buildOpenApi();
    const stubs = [];
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item)) if (op['x-undocumented']) stubs.push(op);
    }
    expect(stubs.length).toBeGreaterThan(0);
    expect(stubs.every((op) => op.responses && op.summary)).toBe(true);
  });
});
