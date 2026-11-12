'use strict';

/**
 * @fileoverview Route-level RBAC and scoped credentials (feature 19).
 *
 * Boots the ServiceRegistry with the portal guard switched off, so these tests
 * prove the permission layer protects admin actions on its own (review
 * findings M-1 and L-1), and checks scoped static keys, scoped personal
 * tokens, the route-coverage check, and the excludePaths '/status' hole.
 */

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');

const serviceRegistry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');
const {
  hasPermission,
  buildRoleMap,
  grantsForRoles,
  normalizeApiKeys
} = require('../../../src/authservice/modules/permissions');
const { permissionFor, listUndeclaredRoutes } = require('../../../src/authservice/policy/routePermissions');

const FULL_KEY = 'rbac-full-key-0123456789abcdef0123456789';
const QUEUE_KEY = 'rbac-queue-key-0123456789abcdef012345678';
const PASSWORD = 'Str0ng!Pass#2026';

describe('permission model', () => {
  it('matches exact, area-wildcard and global grants', () => {
    expect(hasPermission(['filing:read'], 'filing:read')).toBe(true);
    expect(hasPermission(['filing:*'], 'filing:admin')).toBe(true);
    expect(hasPermission(['*'], 'users:manage')).toBe(true);
    expect(hasPermission(['filing:read'], 'filing:write')).toBe(false);
    expect(hasPermission(['file:*'], 'filing:read')).toBe(false);
    expect(hasPermission(null, 'filing:read')).toBe(false);
  });

  it('keeps the pre-feature defaults and accepts custom roles', () => {
    const map = buildRoleMap({ auditor: ['log:read'] });
    expect(grantsForRoles(['user'], map)).toEqual(['filing:read', 'profile:manage']);
    expect(hasPermission(grantsForRoles(['editor'], map), 'filing:write')).toBe(true);
    expect(grantsForRoles(['auditor', 'nobody'], map)).toEqual(['log:read']);
  });

  it('normalises mixed plain and scoped API keys', () => {
    const { keys, scopes } = normalizeApiKeys(['a', { key: 'b', scopes: ['queue:*'] }, { nope: 1 }, '']);
    expect(keys).toEqual(['a', 'b']);
    expect(scopes.get('a')).toBeNull();
    expect(scopes.get('b')).toEqual(['queue:*']);
  });

  it('declares sensible permissions for the sensitive routes', () => {
    expect(permissionFor('POST', '/working/api/run')).toBe('jobs:run');
    expect(permissionFor('GET', '/working/api/stop')).toBe('jobs:admin');
    expect(permissionFor('POST', '/scheduling/api/tasks')).toBe('jobs:schedule');
    expect(permissionFor('POST', '/workflow/api/workflows')).toBe('workflows:define');
    expect(permissionFor('PUT', '/authservice/api/invitations/x/approve')).toBe('invitations:manage');
    expect(permissionFor('GET', '/authservice/api/users')).toBe('users:manage');
    expect(permissionFor('POST', '/filing/api/default/settings')).toBe('filing:admin');
    expect(permissionFor('GET', '/filing/api/download/status')).toBe('filing:read');
    expect(permissionFor('GET', '/filing/api/status')).toBe('public');
    expect(permissionFor('GET', '/filing/views/index.html')).toBeNull();
  });

  it('reports routes under unknown services as undeclared', () => {
    expect(listUndeclaredRoutes([
      { method: 'GET', path: '/services/caching/api/get/:key' },
      { method: 'POST', path: '/services/mystery/api/do' }
    ])).toEqual(['POST /services/mystery/api/do']);
  });
});

describe('enforcement with the portal guard disabled', () => {
  let app;
  let auth;
  let workDir;
  let userToken;
  let adminToken;

  const bearer = (req, token) => req.set('Authorization', `Bearer ${token}`).set('Accept', 'application/json');

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(testDataDir(), 'rbac-'));
    serviceRegistry.reset();
    app = express();
    app.use(express.json());
    serviceRegistry.initialize(app, new EventEmitter(), {
      security: {
        apiKeyAuth: {
          apiKeys: [FULL_KEY, { key: QUEUE_KEY, name: 'queue-worker', scopes: ['queue:*'] }],
          requireApiKey: true
        },
        // The portal guard is off: only the permission layer protects the API.
        servicesAuth: { requireLogin: false }
      }
    });
    serviceRegistry.queue('memory');
    serviceRegistry.filing('local', { baseDir: path.join(workDir, 'files') });
    serviceRegistry.working('default', { activitiesFolder: path.join(workDir, 'activities') });
    serviceRegistry.scheduling('memory');
    serviceRegistry.workflow('memory');
    auth = serviceRegistry.authservice('memory');

    await auth.createUser({ email: 'admin@rbac.test', fullName: 'Admin', password: PASSWORD, role: 'admin' });
    await auth.createUser({ email: 'user@rbac.test', fullName: 'User', password: PASSWORD, role: 'user' });
    const login = async (email) => (await request(app)
      .post('/services/authservice/api/login')
      .send({ email, password: PASSWORD })
      .expect(200)).body.data.session.token;
    adminToken = await login('admin@rbac.test');
    userToken = await login('user@rbac.test');
  }, 30000);

  afterAll(() => {
    serviceRegistry.reset();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const adminOnly = [
    ['get', '/services/authservice/api/users'],
    ['get', '/services/authservice/api/roles'],
    ['put', '/services/authservice/api/invitations/abc/approve'],
    ['get', '/services/authservice/api/invitations'],
    ['post', '/services/filing/api/default/settings'],
    ['post', '/services/working/api/run'],
    ['post', '/services/scheduling/api/tasks'],
    ['post', '/services/workflow/api/workflows'],
    ['post', '/services/workflow/api/defineworkflow'],
    ['get', '/services/queueing/api/settings']
  ];

  it.each(adminOnly)('a user session gets 403 on %s %s', async (method, url) => {
    const res = await bearer(request(app)[method](url), userToken).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });

  it('an admin session passes the permission layer', async () => {
    const res = await bearer(request(app).get('/services/authservice/api/users'), adminToken);
    expect(res.status).toBe(200);
  });

  it('a user can still use their own profile and read documents', async () => {
    await bearer(request(app).get('/services/authservice/api/profile/tokens'), userToken).expect(200);
    const res = await bearer(request(app).get('/services/filing/api/file-tree'), userToken);
    expect(res.status).not.toBe(403);
  });

  it('anonymous requests to protected routes get 401, public ones pass', async () => {
    await request(app).get('/services/authservice/api/users').set('Accept', 'application/json').expect(401);
    await request(app).get('/services/queueing/api/status').expect(200);
  });

  it('a file or key named "status" is not public', async () => {
    const res = await request(app).get('/services/filing/api/download/status').set('Accept', 'application/json');
    expect(res.status).toBe(401);
  });

  it('a scoped static key reaches only its scopes', async () => {
    const ok = await request(app).get('/services/queueing/api/queues').set('x-api-key', QUEUE_KEY);
    expect(ok.status).not.toBe(403);
    expect(ok.status).not.toBe(401);
    const denied = await request(app).post('/services/working/api/run')
      .set('x-api-key', QUEUE_KEY).send({ scriptPath: 'a.js' });
    expect(denied.status).toBe(403);
    const users = await request(app).get('/services/authservice/api/users').set('x-api-key', QUEUE_KEY);
    expect(users.status).toBe(403);
  });

  it('a plain string key keeps full access', async () => {
    const res = await request(app).get('/services/authservice/api/users').set('x-api-key', FULL_KEY);
    expect(res.status).toBe(200);
  });

  it('a scoped personal token cannot exceed its scopes, even for an admin', async () => {
    const created = await bearer(request(app).post('/services/authservice/api/profile/tokens'), adminToken)
      .send({ name: 'read-only', scopes: ['filing:read'] })
      .expect(201);
    expect(created.body.data.scopes).toEqual(['filing:read']);
    const pat = created.body.data.token;

    const read = await request(app).get('/services/filing/api/file-tree').set('x-api-key', pat);
    expect(read.status).not.toBe(403);
    const users = await request(app).get('/services/authservice/api/users').set('x-api-key', pat);
    expect(users.status).toBe(403);
  });

  it('rejects malformed token scopes', async () => {
    await bearer(request(app).post('/services/authservice/api/profile/tokens'), adminToken)
      .send({ name: 'bad', scopes: ['rm -rf'] })
      .expect(400);
  });

  it('every registered /services route declares a permission', () => {
    expect(serviceRegistry.verifyRoutePermissions({ strict: false })).toEqual([]);
  });
});

describe('M-1: data-plane keys and the portal in production', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    serviceRegistry.reset();
  });

  it('a data-plane key cannot open /services/ when no admin keys are configured', async () => {
    process.env.NODE_ENV = 'production';
    serviceRegistry.reset();
    const app = express();
    serviceRegistry.initialize(app, new EventEmitter(), { apiKeys: [FULL_KEY], requireApiKey: true });
    const res = await request(app)
      .get('/services/caching/api/settings')
      .set('x-api-key', FULL_KEY)
      .set('Accept', 'application/json');
    expect(res.status).toBe(401);
  });

  it('an admin key does open it', async () => {
    process.env.NODE_ENV = 'production';
    serviceRegistry.reset();
    const app = express();
    const ADMIN = 'rbac-admin-key-0123456789abcdef01234567';
    serviceRegistry.initialize(app, new EventEmitter(), {
      apiKeys: [FULL_KEY],
      requireApiKey: true,
      security: { servicesAuth: { apiKeys: [ADMIN] } }
    });
    serviceRegistry.cache('memory');
    const res = await request(app).get('/services/caching/api/settings').set('x-api-key', ADMIN);
    expect(res.status).toBe(200);
  });
});
