'use strict';

/**
 * @fileoverview Authorization matrix (feature 22, part 2).
 *
 * Boots every service as app.js does (with temp directories), enumerates every
 * registered /services route, and calls each one as five callers: anonymous, a
 * `user` session, an `admin` session, a scoped static key and an unscoped key.
 * The expected outcome comes from the route's declared permission (feature 19)
 * and, in the app.js configuration, the portal guard's public paths.
 *
 * Every route handler is replaced with a stub that answers 299, so the matrix
 * measures only the app-level gates (API key, portal guard, permission layer),
 * never runs a handler, and has no side effects. A route the matrix cannot
 * classify (no declared permission) fails the test, so it grows with the API.
 */

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');

const serviceRegistry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');
const { permissionFor, listRoutes } = require('../../../src/authservice/policy/routePermissions');
const { hasPermission, grantsForRoles, buildRoleMap } = require('../../../src/authservice/modules/permissions');
const { isPathPublic } = require('../../../src/authservice/middleware/services');

const UNSCOPED_KEY = 'matrix-unscoped-key-0123456789abcdef0123';
const SCOPED_KEY = 'matrix-scoped-key-0123456789abcdef012345';
const SCOPES = ['cache:read', 'queue:*', 'filing:read'];
const PASSWORD = 'Str0ng!Pass#2026';
const REACHED = 299;

/** Turns an Express path into a concrete URL. */
const samplePath = (p) => p
  .replace(/:[A-Za-z_]\w*(\([^)]*\))?\??/g, 'x')
  .replace(/\*/g, 'x')
  .replace(/\/+$/, '') || '/';

/** Boots the registry the way app.js wires it, and stubs every route. */
async function boot(workDir, { portalGuard }) {
  serviceRegistry.reset();
  const app = express();
  app.use(express.json());
  serviceRegistry.initialize(app, new EventEmitter(), {
    logDir: path.join(workDir, 'logs'),
    dataDir: path.join(workDir, 'data'),
    security: {
      apiKeyAuth: {
        apiKeys: [UNSCOPED_KEY, { key: SCOPED_KEY, name: 'matrix-scoped', scopes: SCOPES }],
        requireApiKey: true,
        excludePaths: ['/services/*/status', '/services/', '/services/*/views/*',
          '/services/authservice/api/login', '/services/authservice/api/register']
      },
      servicesAuth: { requireLogin: portalGuard }
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
  const auth = serviceRegistry.authservice('memory');
  serviceRegistry.settings('file', { filepath: path.join(workDir, 'settings', 'settings.enc.json'), secret: 'matrix-settings-secret-0123456789' });
  serviceRegistry.aiservice('mock', {});

  const routes = listRoutes(app)
    .filter((r) => r.path.startsWith('/services/') && !['HEAD', 'OPTIONS'].includes(r.method));
  const stub = (req, res) => res.status(REACHED).json({ reached: true });
  for (const layer of app._router.stack) {
    if (layer.route) for (const inner of layer.route.stack) inner.handle = stub;
  }

  await auth.createUser({ email: 'admin@matrix.test', fullName: 'Admin', password: PASSWORD, role: 'admin' });
  await auth.createUser({ email: 'user@matrix.test', fullName: 'User', password: PASSWORD, role: 'user' });
  const token = async (email) => (await auth.authenticateUser(email, PASSWORD)).session.token;
  return { app, routes, tokens: { admin: await token('admin@matrix.test'), user: await token('user@matrix.test') } };
}

const CALLERS = {
  anonymous: (req) => req,
  user: (req, t) => req.set('Authorization', `Bearer ${t.user}`),
  admin: (req, t) => req.set('Authorization', `Bearer ${t.admin}`),
  scopedKey: (req) => req.set('x-api-key', SCOPED_KEY),
  unscopedKey: (req) => req.set('x-api-key', UNSCOPED_KEY)
};

/** Calls every route as every caller; resolves to rows of { route, caller, status }. */
async function runMatrix(ctx) {
  const unique = new Map();
  for (const r of ctx.routes) unique.set(`${r.method} ${samplePath(r.path)}`, r);
  const rows = [];
  for (const [key, r] of unique) {
    const url = samplePath(r.path);
    const servicesPath = url.replace(/^\/services/, '');
    const permission = permissionFor(r.method, servicesPath);
    if (permission === null) continue; // pages and static files, not APIs
    for (const [caller, apply] of Object.entries(CALLERS)) {
      const req = apply(request(ctx.app)[r.method.toLowerCase()](url).set('Accept', 'application/json'), ctx.tokens);
      const res = r.method === 'GET' || r.method === 'DELETE' ? await req : await req.send({});
      rows.push({ key, method: r.method, url, servicesPath, permission, caller, status: res.status, code: res.body && res.body.code });
    }
  }
  return rows;
}

const roleMap = buildRoleMap({});
const grants = { user: grantsForRoles(['user'], roleMap), admin: grantsForRoles(['admin'], roleMap) };

/** Whether the permission layer alone lets the caller through. */
function permissionAllows(caller, permission) {
  if (permission === null || permission === 'public') return true;
  switch (caller) {
    case 'anonymous': return false;
    case 'user': return hasPermission(grants.user, permission);
    case 'admin': return hasPermission(grants.admin, permission);
    case 'scopedKey': return hasPermission(SCOPES, permission);
    case 'unscopedKey': return true;
    default: throw new Error(caller);
  }
}

const describeRow = (r) => `${r.caller.padEnd(11)} ${r.key} [${r.permission}] -> ${r.status}${r.code ? ` ${r.code}` : ''}`;

describe('authorization matrix', () => {
  let workDir;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(testDataDir(), 'authz-matrix-'));
  });

  afterAll(() => {
    serviceRegistry.reset();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  describe('permission layer alone (portal guard off)', () => {
    let ctx;
    let rows;

    beforeAll(async () => {
      ctx = await boot(path.join(workDir, 'a'), { portalGuard: false });
      rows = await runMatrix(ctx);
    }, 120000);

    it('covers every /services API route, and every one declares a permission', () => {
      const apiRoutes = new Set(rows.map((r) => r.key));
      expect(apiRoutes.size).toBeGreaterThan(300);
      const undeclared = [...new Set(rows.filter((r) => r.permission === undefined).map((r) => r.key))];
      expect(undeclared).toEqual([]);
    });

    it('lets each caller through exactly where its grants or scopes allow', () => {
      const wrong = rows.filter((r) => {
        const expected = permissionAllows(r.caller, r.permission);
        return expected ? r.status !== REACHED : ![401, 403].includes(r.status);
      });
      expect(wrong.map(describeRow)).toEqual([]);
    });

    it('denies with the right status: 401 without credentials, 403 with insufficient ones', () => {
      const denied = rows.filter((r) => r.status !== REACHED);
      expect(denied.filter((r) => r.caller === 'anonymous' && r.status !== 401).map(describeRow)).toEqual([]);
      expect(denied.filter((r) => r.caller !== 'anonymous' && r.status !== 403).map(describeRow)).toEqual([]);
      expect(denied.filter((r) => r.caller !== 'anonymous').every((r) => r.code === 'PERMISSION_DENIED')).toBe(true);
    });

    it('denies a plain user every admin action', () => {
      const adminish = rows.filter((r) => r.caller === 'user' && /:(admin|manage)$/.test(r.permission || '') && r.permission !== 'profile:manage');
      expect(adminish.length).toBeGreaterThan(50);
      expect(adminish.filter((r) => r.status === REACHED).map(describeRow)).toEqual([]);
    });
  });

  describe('as app.js configures it (portal guard on)', () => {
    let ctx;
    let rows;

    beforeAll(async () => {
      ctx = await boot(path.join(workDir, 'b'), { portalGuard: true });
      rows = await runMatrix(ctx);
    }, 120000);

    it('admin sessions and unscoped keys reach every API route', () => {
      const wrong = rows.filter((r) => r.permission !== null && ['admin', 'unscopedKey'].includes(r.caller) && r.status !== REACHED);
      expect(wrong.map(describeRow)).toEqual([]);
    });

    it('anonymous callers reach only routes both layers declare public', () => {
      const wrong = rows.filter((r) => {
        if (r.caller !== 'anonymous' || r.permission === null) return false;
        const expected = r.permission === 'public' && isPathPublic(r.servicesPath, r.method);
        return expected ? r.status !== REACHED : r.status === REACHED;
      });
      expect(wrong.map(describeRow)).toEqual([]);
    });

    it('a user session and a scoped key never get past what the permission table allows', () => {
      const leaks = rows.filter((r) => ['user', 'scopedKey'].includes(r.caller) && r.permission !== null &&
        !permissionAllows(r.caller, r.permission) && r.status === REACHED);
      expect(leaks.map(describeRow)).toEqual([]);
    });

    it('a user can still reach their profile and read documents', () => {
      const reach = (re, method = 'GET') => rows.find((r) => r.caller === 'user' && r.method === method && re.test(r.servicesPath));
      expect(reach(/^\/authservice\/api\/profile\/tokens$/).status).toBe(REACHED);
      expect(reach(/^\/filing\/api\/file-tree$/).status).toBe(REACHED);
    });
  });
});
