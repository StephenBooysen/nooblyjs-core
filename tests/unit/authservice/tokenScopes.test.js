/**
 * @fileoverview Scoped personal access tokens (feature 19): a token may carry
 * fewer permissions than its owner, never more, and the permission gate applies
 * both the owner's grants and the token's scopes.
 */
'use strict';

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '6';

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');
const createAuthService = require('../../../src/authservice');
const { createPermissionGate } = require('../../../src/authservice/middleware/permissionGate');
const { RouteDeclarations } = require('../../../src/authservice/modules/routeDeclarations');
const { validateTokenScopes } = require('../../../src/authservice/modules/permissions');

const EMAIL = 'scoped@example.com';
const PASSWORD = 'Str0ng!Passw0rd';

function mockApp() {
  return { use: jest.fn(), get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() };
}

async function freshAuth(role) {
  const auth = createAuthService('memory', { 'express-app': mockApp(), dependencies: {} }, new EventEmitter());
  await auth.createUser({ email: EMAIL, fullName: 'Scoped', password: PASSWORD, role });
  return auth;
}

describe('validateTokenScopes', () => {
  it('accepts permissions the owner holds', () => {
    expect(validateTokenScopes(['filing:read', 'filing:read'], ['user'])).toEqual(['filing:read']);
    expect(validateTokenScopes(['*'], ['admin'])).toEqual(['*']);
  });

  it('refuses a scope wider than the owner, and malformed scopes', () => {
    expect(() => validateTokenScopes(['filing:write'], ['user'])).toThrow(/wider/);
    expect(() => validateTokenScopes(['*'], ['editor'])).toThrow(/wider/);
    expect(() => validateTokenScopes([], ['admin'])).toThrow(/non-empty/);
    expect(() => validateTokenScopes(['filing read'], ['admin'])).toThrow(/Invalid/);
    expect(() => validateTokenScopes('filing:read', ['admin'])).toThrow(/non-empty/);
  });
});

describe('scoped token issuance and validation', () => {
  it('stores scopes on the token and returns them on validation', async () => {
    const auth = await freshAuth('editor');
    const created = await auth.createApiToken(EMAIL, 'ci', { scopes: ['caching:read'] });
    expect(created.scopes).toEqual(['caching:read']);
    const info = await auth.validateApiToken(created.token);
    expect(info.scopes).toEqual(['caching:read']);
  });

  it('keeps an unscoped token unrestricted (scopes null)', async () => {
    const auth = await freshAuth('user');
    const created = await auth.createApiToken(EMAIL, 'plain');
    expect(created.scopes).toBeNull();
    expect((await auth.validateApiToken(created.token)).scopes).toBeNull();
  });

  it('refuses a "permissions" option instead of issuing an unscoped token', async () => {
    const auth = await freshAuth('admin');
    await expect(auth.createApiToken(EMAIL, 'wrong-option', { permissions: ['filing:read'] })).rejects.toThrow(/use "scopes"/);
    expect(await auth.listApiTokens(EMAIL)).toHaveLength(0);
  });

  it('refuses to issue a token wider than its owner', async () => {
    const auth = await freshAuth('user');
    await expect(auth.createApiToken(EMAIL, 'bad', { scopes: ['users:manage'] })).rejects.toThrow(/wider/);
  });
});

describe('permission gate with a scoped token', () => {
  function appFor(principal) {
    const app = express();
    app.use('/services', createPermissionGate({
      resolvePrincipal: async () => principal,
      declarations: new RouteDeclarations({ 'GET /services/caching/api/list': 'caching:read' }),
      strict: () => true
    }));
    app.all('/services/*', (req, res) => res.json({ reached: true }));
    return app;
  }

  it('lets a token use a scope its owner holds', async () => {
    const app = appFor({ principal: EMAIL, roles: ['editor'], tokenScopes: ['caching:read'] });
    await request(app).get('/services/caching/api/list').expect(200);
  });

  it('refuses a permission the token does not carry, even if the owner holds it', async () => {
    const app = appFor({ principal: EMAIL, roles: ['editor'], tokenScopes: ['filing:read'] });
    const res = await request(app).get('/services/caching/api/list');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
  });
});
