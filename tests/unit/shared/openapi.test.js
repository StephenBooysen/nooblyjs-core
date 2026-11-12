/**
 * @fileoverview Unit tests for the OpenAPI merge (feature 10): path matching,
 * documented vs generated operations, stale detection, component renames and
 * the YAML writer.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const { buildOpenApiDocument, canonicalPath, toOpenApiPath, toYaml } = require('../../../src/shared/utils/openapi');

describe('OpenAPI path helpers', () => {
  it('treats {param}, :param, :param(*) and :param? as the same parameter', () => {
    const forms = ['/services/caching/api/put/{key}', '/services/caching/api/put/:key', '/services/caching/api/put/:path(*)', '/services/caching/api/put/:key?'];
    const canon = new Set(forms.map(canonicalPath));
    expect(canon.size).toBe(1);
  });

  it('converts Express parameters to OpenAPI braces', () => {
    expect(toOpenApiPath('/services/filing/api/download/:wildcard0(*)')).toBe('/services/filing/api/download/{wildcard0}');
    expect(toOpenApiPath('/a/:x/b/:y?')).toBe('/a/{x}/b/{y}');
  });
});

describe('buildOpenApiDocument', () => {
  const docFor = (paths, components) => ({ openapi: '3.0.0', paths, components: components || {} });

  it('uses the documented operation when a route matches, with the service tag', () => {
    const docs = [{
      segment: 'caching',
      doc: docFor({
        '/put/{key}': {
          post: { summary: 'Store cache entry', operationId: 'putCache', responses: { 200: { description: 'ok' } } }
        }
      })
    }];
    const { document, stale, documented, generated } = buildOpenApiDocument({
      routes: [{ method: 'POST', path: '/services/caching/api/put/:key' }],
      docs
    });
    const op = document.paths['/services/caching/api/put/{key}'].post;
    expect(op.summary).toBe('Store cache entry');
    expect(op.tags).toEqual(['caching']);
    expect(op.operationId).toBe('putCache');
    expect(op['x-generated']).toBeUndefined();
    expect(stale).toEqual([]);
    expect(documented).toBe(1);
    expect(generated).toBe(0);
  });

  it('generates a stub for a mounted route with no documentation', () => {
    const { document, generated } = buildOpenApiDocument({
      routes: [{ method: 'GET', path: '/services/queueing/api/:instanceName/size/:queueName' }],
      docs: []
    });
    const op = document.paths['/services/queueing/api/{instanceName}/size/{queueName}'].get;
    expect(op['x-generated']).toBe(true);
    expect(op.parameters.map((p) => p.name)).toEqual(['instanceName', 'queueName']);
    expect(op.parameters.every((p) => p.in === 'path' && p.required)).toBe(true);
    expect(generated).toBe(1);
  });

  it('reports documented operations that have no route as stale, and leaves them out', () => {
    const docs = [{
      segment: 'measuring',
      doc: docFor({ '/max/{metric}': { get: { summary: 'gone' } }, '/add': { post: { summary: 'Add' } } })
    }];
    const { document, stale } = buildOpenApiDocument({
      routes: [{ method: 'POST', path: '/services/measuring/api/add' }],
      docs
    });
    expect(stale).toEqual(['GET /services/measuring/api/max/{}']);
    expect(document.paths['/services/measuring/api/max/{metric}']).toBeUndefined();
    expect(document.paths['/services/measuring/api/add'].post.summary).toBe('Add');
  });

  it('matches documents that already carry the /services prefix', () => {
    const docs = [{
      segment: 'logging',
      doc: docFor({ '/services/logging/api/status': { get: { summary: 'Status' } } })
    }];
    const { stale } = buildOpenApiDocument({
      routes: [{ method: 'GET', path: '/services/logging/api/status' }],
      docs
    });
    expect(stale).toEqual([]);
  });

  it('renames a component that two documents define differently, and rewrites its references', () => {
    const docs = [
      {
        segment: 'caching',
        doc: docFor(
          { '/a': { get: { responses: { 200: { $ref: '#/components/responses/Success' } } } } },
          { responses: { Success: { description: 'Caching success' } } }
        )
      },
      {
        segment: 'queueing',
        doc: docFor(
          { '/b': { get: { responses: { 200: { $ref: '#/components/responses/Success' } } } } },
          { responses: { Success: { description: 'Queueing success' } } }
        )
      }
    ];
    const { document } = buildOpenApiDocument({
      routes: [
        { method: 'GET', path: '/services/caching/api/a' },
        { method: 'GET', path: '/services/queueing/api/b' }
      ],
      docs
    });
    expect(document.components.responses.Success.description).toBe('Caching success');
    expect(document.components.responses.queueing_Success.description).toBe('Queueing success');
    expect(document.paths['/services/queueing/api/b'].get.responses[200]).toEqual({ $ref: '#/components/responses/queueing_Success' });
    expect(document.paths['/services/caching/api/a'].get.responses[200]).toEqual({ $ref: '#/components/responses/Success' });
  });

  it('gives every operation a unique operationId', () => {
    const { document } = buildOpenApiDocument({
      routes: [
        { method: 'GET', path: '/services/caching/api/status' },
        { method: 'GET', path: '/services/caching/api/:instanceName/status' }
      ],
      docs: [{ segment: 'caching', doc: docFor({ '/status': { get: { operationId: 'status' } } }) }]
    });
    const ids = [];
    for (const item of Object.values(document.paths)) for (const op of Object.values(item)) ids.push(op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares the security schemes and tags the platform routes separately', () => {
    const { document } = buildOpenApiDocument({
      routes: [{ method: 'GET', path: '/services/api/openapi.json' }],
      docs: [],
      version: '9.9.9'
    });
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe('9.9.9');
    expect(Object.keys(document.components.securitySchemes)).toEqual(expect.arrayContaining(['ApiKeyAuth', 'BearerAuth', 'SessionCookie']));
    expect(document.paths['/services/api/openapi.json'].get.tags).toEqual(['platform']);
  });
});

describe('toYaml', () => {
  it('writes nested objects and arrays that read back as the same keys and values', () => {
    const value = {
      openapi: '3.1.0',
      paths: { '/services/x/{id}': { get: { parameters: [{ name: 'id', in: 'path', required: true }], tags: ['x'] } } },
      empty: [],
      flag: false,
      text: 'a "quoted": value'
    };
    const yaml = toYaml(value);
    expect(yaml).toContain('openapi: "3.1.0"');
    expect(yaml).toContain('"/services/x/{id}":');
    expect(yaml).toContain('empty: []');
    expect(yaml).toContain('flag: false');
    expect(yaml).toContain('text: "a \\"quoted\\": value"');
    expect(yaml).toContain('    - name: "id"');
  });
});
