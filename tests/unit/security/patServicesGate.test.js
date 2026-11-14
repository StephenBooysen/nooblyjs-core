/**
 * @fileoverview Personal access tokens through the services login gate
 * (features 03 and 19). With `servicesAuth.requireLogin` on (the default), an
 * admin-owned token opens the API paths and the MCP endpoint, never the
 * dashboard pages; a token owned by anyone else is refused; and the token's
 * scopes still apply at the permission gate.
 */
'use strict';

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '6';

const path = require('path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const registry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');

const PASSWORD = 'Str0ng!Passw0rd#2026';

describe('personal access tokens through the services login gate', () => {
  let app;
  let tokens;

  beforeAll(async () => {
    const dir = testDataDir('pat-gate');
    app = express();
    app.use(express.json());
    registry.initialize(app, new EventEmitter(), {
      logDir: path.join(dir, 'logs'),
      dataDir: dir,
      security: { apiKeyAuth: { requireApiKey: true, apiKeys: ['k'.repeat(32)] }, servicesAuth: { requireLogin: true } },
      mcp: { enabled: true }
    });
    registry.logger('memory');
    registry.cache('memory');
    const auth = registry.authservice('memory', {});
    await auth.createUser({ email: 'admin@example.com', fullName: 'Admin', password: PASSWORD, role: 'admin' });
    await auth.createUser({ email: 'user@example.com', fullName: 'User', password: PASSWORD, role: 'user' });
    tokens = {
      admin: (await auth.createApiToken('admin@example.com', 'full')).token,
      logsOnly: (await auth.createApiToken('admin@example.com', 'logs', { scopes: ['logging:read'] })).token,
      user: (await auth.createApiToken('user@example.com', 'user')).token
    };
  });

  afterAll(async () => { await registry.shutdown?.(); registry.reset?.(); });

  const call = (token, method, url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
  const mcp = (token, message) => call(token, 'post', '/services/mcp').send(message);

  it('lets an admin-owned token call a service API and the registry API', async () => {
    await call(tokens.admin, 'get', '/services/caching/api/list').expect(200);
    await call(tokens.admin, 'get', '/services/api/monitoring/snapshot').expect(200);
  });

  it('lets an admin-owned token use the MCP endpoint', async () => {
    const res = await mcp(tokens.admin, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(200);
    expect(res.body.result.tools.map((t) => t.name)).toContain('logs.recent');
  });

  it('does not open dashboard pages with a token: it gets the same sign-in page as anyone', async () => {
    const anonymous = await request(app).get('/services/caching/').set('Accept', 'text/html');
    const withToken = await call(tokens.admin, 'get', '/services/caching/').set('Accept', 'text/html');
    expect(withToken.status).toBe(anonymous.status);
    expect(withToken.text).toBe(anonymous.text);
    expect(withToken.text).toMatch(/login/i);
  });

  it('refuses a token whose owner is not an admin', async () => {
    await call(tokens.user, 'get', '/services/caching/api/list').expect(403);
    await mcp(tokens.user, { jsonrpc: '2.0', id: 1, method: 'ping' }).expect(403);
  });

  it('refuses an unknown or revoked token', async () => {
    await call('dtk_not-a-real-token', 'get', '/services/caching/api/list').expect(401);
  });

  it('still applies the token scopes: a logging:read token cannot read the cache', async () => {
    await call(tokens.logsOnly, 'get', '/services/caching/api/list').expect(403);
    const allowed = await mcp(tokens.logsOnly, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'logs.recent', arguments: {} } }).expect(200);
    expect(allowed.body.result.isError).toBe(false);
    const refused = await mcp(tokens.logsOnly, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'queue.stats', arguments: { queue: 'q' } } }).expect(200);
    expect(refused.body.result.isError).toBe(true);
    expect(refused.body.result.content[0].text).toMatch(/Forbidden/);
  });
});
