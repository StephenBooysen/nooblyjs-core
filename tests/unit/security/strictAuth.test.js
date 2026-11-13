/**
 * @fileoverview strictAuth mode (feature 19): the gate uses the declared
 * permission of each route, refuses routes nobody declared, and start-up fails
 * when a /services/*\/api route has no declaration.
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { createPermissionGate } = require('../../../src/authservice/middleware/permissionGate');
const { RouteDeclarations, findUndeclaredRoutes } = require('../../../src/authservice/modules/routeDeclarations');
const { permissionsForRoles } = require('../../../src/authservice/modules/permissions');

const PRINCIPALS = {
  user: { roles: ['user'] },
  editor: { roles: ['editor'] },
  admin: { roles: ['admin'] }
};

function appWith(strict) {
  const app = express();
  app.use(express.json());
  app.use('/services', createPermissionGate({
    resolvePrincipal: async (req) => {
      const who = req.headers['x-principal'];
      return PRINCIPALS[who] ? { principal: who, ...PRINCIPALS[who] } : null;
    },
    declarations: new RouteDeclarations({
      'GET /services/caching/api/list': 'caching:read',
      'POST /services/working/api/run': 'jobs:run'
    }),
    strict: () => strict
  }));
  app.all('/services/*', (req, res) => res.json({ reached: true }));
  return app;
}

describe('strictAuth permission gate (feature 19)', () => {
  it('uses the declared permission for a declared route', async () => {
    const app = appWith(true);
    await request(app).get('/services/caching/api/list').set('x-principal', 'user').expect(403);
    await request(app).get('/services/caching/api/list').set('x-principal', 'editor').expect(200);
    await request(app).post('/services/working/api/run').set('x-principal', 'user').expect(403);
    await request(app).post('/services/working/api/run').set('x-principal', 'admin').expect(200);
  });

  it('refuses an undeclared route to everyone but the admin wildcard', async () => {
    const app = appWith(true);
    const res = await request(app).get('/services/nothing/api/here').set('x-principal', 'editor');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    await request(app).get('/services/nothing/api/here').set('x-principal', 'admin').expect(200);
  });

  it('keeps the legacy default for undeclared routes outside strict mode', async () => {
    const app = appWith(false);
    await request(app).get('/services/nothing/api/here').set('x-principal', 'user').expect(403);
    await request(app).get('/services/caching/api/list').set('x-principal', 'editor').expect(200);
  });
});

describe('editor role (feature 19)', () => {
  it('grants editors filing and caching but not administration', () => {
    const granted = permissionsForRoles(['editor']);
    expect(granted).toEqual(expect.arrayContaining(['filing:*', 'caching:*']));
    expect(granted).not.toContain('*');
    expect(granted).not.toEqual(expect.arrayContaining(['users:manage']));
  });
});

describe('start-up check for undeclared routes (feature 19)', () => {
  it('lists an undeclared API route', () => {
    const app = express();
    app.get('/services/example/api/ping', (req, res) => res.json({}));
    expect(findUndeclaredRoutes(app, new RouteDeclarations({}))).toEqual(['GET /services/example/api/ping']);
  });

  it('is clear once the route is declared', () => {
    const app = express();
    app.get('/services/example/api/ping', (req, res) => res.json({}));
    const declarations = new RouteDeclarations({ 'GET /services/example/api/ping': 'example:read' });
    expect(findUndeclaredRoutes(app, declarations)).toEqual([]);
  });
});

describe('ServiceRegistry.verifyRouteDeclarations (feature 19)', () => {
  const registry = require('../../../index');
  let app;
  beforeEach(() => {
    app = express();
    registry.reset?.();
    registry.initialized = false;
    registry.initialize(app, undefined, { apiKeys: ['k'], security: { servicesAuth: { requireLogin: false }, strictAuth: true } });
    app.get('/services/undeclared/api/thing', (req, res) => res.json({}));
  });
  afterEach(async () => {
    await registry.shutdown?.();
    registry.reset?.();
  });

  it('fails start-up in strictAuth mode when a route has no declaration', () => {
    expect(registry.strictAuth).toBe(true);
    expect(() => registry.verifyRouteDeclarations()).toThrow(/GET \/services\/undeclared\/api\/thing/);
  });

  it('only reports the route outside strictAuth mode', () => {
    registry.strictAuth = false;
    expect(registry.verifyRouteDeclarations()).toEqual(['GET /services/undeclared/api/thing']);
  });
});
