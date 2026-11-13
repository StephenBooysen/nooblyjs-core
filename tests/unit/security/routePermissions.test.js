/**
 * @fileoverview Authorization matrix for route permissions (review 2026-11-12,
 * findings C-1, M-1; feature 19).
 *
 * Each sensitive route is called as an anonymous caller, a user, an editor, an
 * admin, a key scoped to one service, and an unscoped key, and the status is
 * compared with the expected outcome.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { createPermissionGate } = require('../../../src/authservice/middleware/permissionGate');
const { createServicesAuthMiddleware } = require('../../../src/authservice/middleware/services');
const registry = require('../../../index');

const PRINCIPALS = {
  anonymous: null,
  user: { roles: ['user'] },
  editor: { roles: ['editor'] },
  admin: { roles: ['admin'] },
  scopedQueueKey: { scopes: ['queueing:*'] },
  unscopedKey: { scopes: null }
};

/** Builds an app with the gate, where the caller is picked by an x-principal header. */
function appWith(gateOptions = {}) {
  const app = express();
  app.use(express.json());
  app.use('/services', createPermissionGate({
    resolvePrincipal: async (req) => {
      const who = req.headers['x-principal'];
      const p = PRINCIPALS[who];
      return p ? { principal: who, ...p } : null;
    },
    ...gateOptions
  }));
  app.all('/services/*', (req, res) => res.json({ reached: true }));
  return app;
}

/** Each row: method, path, and the status expected for every principal. */
const MATRIX = [
  // Admin-tier routes called out in the review.
  { method: 'post', path: '/services/working/api/run', expect: { anonymous: 200, user: 403, editor: 403, admin: 200, scopedQueueKey: 403, unscopedKey: 200 } },
  { method: 'post', path: '/services/scheduling/api/tasks', expect: { user: 403, editor: 403, admin: 200, unscopedKey: 200 } },
  { method: 'post', path: '/services/workflow/api/definitions', expect: { user: 403, editor: 403, admin: 200, unscopedKey: 200 } },
  { method: 'get', path: '/services/authservice/api/users', expect: { user: 403, editor: 403, admin: 200 } },
  { method: 'post', path: '/services/authservice/api/roles/auditor/users', expect: { user: 403, editor: 403, admin: 200 } },
  { method: 'put', path: '/services/authservice/api/invitations/abc123/approve', expect: { user: 403, editor: 403, admin: 200 } },
  { method: 'get', path: '/services/authservice/api/invitations', expect: { user: 403, admin: 200 } },
  { method: 'put', path: '/services/settings/api/mygroup', expect: { user: 403, editor: 403, admin: 200 } },
  // Routes that stay open to their own users.
  { method: 'post', path: '/services/authservice/api/login', expect: { anonymous: 200, user: 200 } },
  { method: 'post', path: '/services/authservice/api/invitations', expect: { anonymous: 200, user: 200 } },
  { method: 'put', path: '/services/authservice/api/profile/password', expect: { user: 200, editor: 200, admin: 200 } },
  { method: 'post', path: '/services/authservice/api/profile/tokens', expect: { user: 200, admin: 200 } },
  // Filing follows the role tiers.
  { method: 'get', path: '/services/filing/api/browse', expect: { user: 200, editor: 200 } },
  { method: 'post', path: '/services/filing/api/upload/a.txt', expect: { user: 403, editor: 200, admin: 200 } },
  { method: 'delete', path: '/services/filing/api/remove/a.txt', expect: { user: 403, editor: 200 } },
  // Scoped keys reach only their service.
  { method: 'post', path: '/services/queueing/api/enqueue/emails', expect: { scopedQueueKey: 200, user: 403, unscopedKey: 200 } },
  { method: 'get', path: '/services/caching/api/list', expect: { scopedQueueKey: 403, editor: 200, admin: 200, user: 403 } }
];

describe('route permissions matrix (C-1, M-1, feature 19)', () => {
  const app = appWith();

  for (const row of MATRIX) {
    for (const [who, status] of Object.entries(row.expect)) {
      it(`${row.method.toUpperCase()} ${row.path} as ${who} -> ${status}`, async () => {
        const res = await request(app)[row.method](row.path).set('x-principal', who);
        expect(res.status).toBe(status);
        if (status === 403) expect(res.body.code).toBe('PERMISSION_DENIED');
      });
    }
  }

  it('ignores paths that are not API routes', async () => {
    await request(app).get('/services/caching/views/index.html').set('x-principal', 'user').expect(200);
  });

  it('emits a denial event with the principal and the permission', async () => {
    const events = [];
    const withEvents = appWith({ eventEmitter: { emit: (name, data) => events.push({ name, data }) } });
    await request(withEvents).post('/services/working/api/run').set('x-principal', 'user').expect(403);
    expect(events).toEqual([expect.objectContaining({
      name: 'auth:permission-denied',
      data: expect.objectContaining({ principal: 'user', permission: 'jobs:run' })
    })]);
  });
});

describe('portal guard and data-plane keys (M-1)', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIGINAL_ENV; });

  function portalFor(globalOptions) {
    const app = express();
    const reg = {
      authservice: () => ({ validateSession: async () => { throw new Error('invalid'); } }),
      globalOptions,
      securityConfig: {}
    };
    app.use('/services', createServicesAuthMiddleware(reg));
    app.all('/services/*', (_req, res) => res.json({ reached: true }));
    return app;
  }

  it('does not let a general key open the portal in production without admin keys', async () => {
    process.env.NODE_ENV = 'production';
    const app = portalFor({ apiKeys: ['general-key-1234567890'] });
    const res = await request(app).get('/services/caching/api/list').set('x-api-key', 'general-key-1234567890');
    expect(res.status).not.toBe(200);
  });

  it('still lets a general key through in development, as before', async () => {
    process.env.NODE_ENV = 'development';
    const app = portalFor({ apiKeys: ['general-key-1234567890'] });
    await request(app).get('/services/caching/api/list').set('x-api-key', 'general-key-1234567890').expect(200);
  });

  it('lets only an admin key that is unscoped or scoped * open the portal', async () => {
    process.env.NODE_ENV = 'production';
    const app = portalFor({ adminApiKeys: [{ key: 'admin-scoped-key-123456', name: 'ops', scopes: ['queueing:*'] }] });
    const res = await request(app).get('/services/caching/api/list').set('x-api-key', 'admin-scoped-key-123456');
    expect(res.status).not.toBe(200);

    const full = portalFor({ adminApiKeys: [{ key: 'admin-full-key-1234567', name: 'ops', scopes: ['*'] }] });
    await request(full).get('/services/caching/api/list').set('x-api-key', 'admin-full-key-1234567').expect(200);
  });
});

describe('principal resolution', () => {
  it('reads a scoped key from the header and returns its scopes', async () => {
    const reg = Object.create(Object.getPrototypeOf(registry));
    reg.globalOptions = { apiKeys: [{ key: 'ci-key-1234567890', name: 'ci', scopes: ['queueing:*'] }] };
    const p = await reg.resolveRequestPrincipal({ headers: { 'x-api-key': 'ci-key-1234567890' } });
    expect(p).toEqual({ principal: 'key:ci', scopes: ['queueing:*'] });
    expect(await reg.resolveRequestPrincipal({ headers: { 'x-api-key': 'wrong' } })).toBeNull();
  });

  it('reads the roles of a session user', async () => {
    const p = await registry.resolveRequestPrincipal({ headers: {}, user: { email: 'a@x.com', roles: ['editor'] } });
    expect(p).toEqual({ principal: 'a@x.com', roles: ['editor'] });
  });
});
