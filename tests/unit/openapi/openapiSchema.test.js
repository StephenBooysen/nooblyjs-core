/**
 * @fileoverview Request schemas in the OpenAPI document (feature 10). A route
 * validated with validate() gets its path, query and body rules described
 * even before the service writes docs for it. Also checks the merged document's
 * structure and the docs page.
 */
'use strict';

const express = require('express');
const path = require('path');
const { validate } = require('../../../src/shared/utils/validation');
const { listApiRoutes } = require('../../../src/authservice/modules/routeDeclarations');
const om = require('../../../src/shared/utils/openapi');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

describe('validate() schema export (feature 10)', () => {
  it('keeps the rules on the middleware it returns', () => {
    const rules = { body: { email: { type: 'string', required: true } } };
    expect(validate(rules).schema).toBe(rules);
  });

  it('lists each route with its schema', () => {
    const app = express();
    app.post('/services/demo/api/items/:id', validate({
      params: { id: { type: 'string', required: true } },
      body: { title: { type: 'string', required: true, maxLength: 80 } }
    }), (req, res) => res.end());
    const [route] = listApiRoutes(app).filter((r) => r.method === 'POST');
    expect(route.schema.body.title.maxLength).toBe(80);
  });
});

describe('stubs for undocumented routes (feature 10)', () => {
  const routes = [{
    method: 'POST',
    pattern: '/services/demo/api/items/:id',
    permission: 'demo:write',
    schema: {
      params: { id: { type: 'string', required: true } },
      query: { limit: { type: 'integer', min: 1, max: 100 } },
      body: {
        title: { type: 'string', required: true, maxLength: 80 },
        count: { type: 'number' },
        tags: { type: 'array', maxLength: 5 }
      }
    }
  }];
  const doc = om.buildOpenApiDocument({ services: [], routes, serverUrl: '/' });
  const op = doc.paths['/services/demo/api/items/{id}'].post;

  it('describes the path parameter, query parameter and request body', () => {
    expect(op['x-undocumented']).toBe(true);
    const byName = Object.fromEntries(op.parameters.map((p) => [p.name, p]));
    expect(byName.id).toEqual(expect.objectContaining({ in: 'path', required: true }));
    expect(byName.limit).toEqual(expect.objectContaining({ in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } }));
    const body = op.requestBody.content['application/json'].schema;
    expect(body.properties.title).toEqual({ type: 'string', maxLength: 80 });
    expect(body.properties.tags).toEqual({ type: 'array', maxItems: 5 });
    expect(body.required).toEqual(['title']);
  });

  it('describes a bare path placeholder as a required string when there are no rules', () => {
    const bare = om.buildOpenApiDocument({
      services: [],
      routes: [{ method: 'GET', pattern: '/services/demo/api/things/:thing', permission: 'demo:read', schema: null }],
      serverUrl: '/'
    });
    const params = bare.paths['/services/demo/api/things/{thing}'].get.parameters;
    expect(params).toEqual([{ name: 'thing', in: 'path', required: true, schema: { type: 'string' } }]);
  });
});

describe('merged document structure (feature 10)', () => {
  const services = om.loadServiceDocuments(SRC);
  const doc = om.buildOpenApiDocument({ services, routes: [], serverUrl: '/' });
  const operations = Object.entries(doc.paths).flatMap(([p, item]) =>
    Object.entries(item)
      .filter(([m]) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
      .map(([m, o]) => ({ p, m, o })));

  it('gives every operation a response', () => {
    const missing = operations.filter(({ o }) => !o.responses || Object.keys(o.responses).length === 0);
    expect(missing.map(({ m, p }) => `${m.toUpperCase()} ${p}`)).toEqual([]);
  });

  it('uses each operationId once', () => {
    const ids = operations.map(({ o }) => o.operationId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares every path placeholder as a parameter', () => {
    const undeclared = [];
    for (const { p, m, o } of operations) {
      const names = [...p.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
      const declared = new Set((o.parameters || []).filter((x) => x.in === 'path').map((x) => x.name));
      for (const n of names) if (!declared.has(n)) undeclared.push(`${m.toUpperCase()} ${p} {${n}}`);
    }
    expect(undeclared).toEqual([]);
  });
});

describe('API docs page (feature 10)', () => {
  it('ships the page and its external script, with no inline script', () => {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(SRC, 'views', 'api-docs.html'), 'utf8');
    expect(html).toMatch(/src="\/services\/js\/api-docs\.js"/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(fs.existsSync(path.join(SRC, 'views', 'js', 'api-docs.js'))).toBe(true);
  });
});
