/**
 * @fileoverview Unit tests for the /services portal admin guard.
 *
 * Covers the public-path allow list (including the read-only restriction on
 * status and static-asset paths), Passport sessions, admin and general API
 * keys, bearer/query/session auth tokens, the login-page shortcut for admins,
 * and the HTML vs JSON responses for unauthenticated and non-admin callers.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const express = require('express');
const request = require('supertest');

const { createServicesAuthMiddleware } = require('../../../src/authservice/middleware/services');

const SESSIONS = {
  'admin-token': { email: 'admin@x.com', userId: '1', roles: ['admin'] },
  'user-token': { email: 'user@x.com', userId: '2', role: 'user' }
};

/** Builds an app guarded by the middleware, echoing what reached the route. */
function makeApp({ registry: overrides = {}, user, session } = {}) {
  const registry = {
    authservice: () => ({
      validateSession: async (token) => {
        if (!SESSIONS[token]) throw new Error('invalid');
        return SESSIONS[token];
      }
    }),
    globalOptions: {},
    securityConfig: {},
    ...overrides
  };
  const app = express();
  app.use((req, res, next) => {
    if (user) {
      req.user = user;
      req.isAuthenticated = () => true;
    }
    if (session) req.session = session;
    next();
  });
  app.use('/services', createServicesAuthMiddleware(registry));
  app.all('/services/*', (req, res) => res.json({ reached: true, user: req.user || null, apiKey: req.apiKey || null }));
  return app;
}

describe('services auth middleware', () => {
  describe('public paths', () => {
    const app = makeApp();

    it.each([
      ['get', '/services/authservice/views/login.html'],
      ['get', '/services/authservice/redeem-invitation'],
      ['get', '/services/authservice/logout'],
      ['post', '/services/authservice/api/logout'],
      ['post', '/services/authservice/api/validate'],
      ['post', '/services/authservice/api/register'],
      ['get', '/services/authservice/api/branding'],
      ['post', '/services/authservice/api/auth/password/validate'],
      ['get', '/services/authservice/api/azure'],
      ['get', '/services/authservice/openid/return'],
      ['get', '/services/authservice/api/sso-config'],
      ['post', '/services/authservice/api/invitations'],
      ['get', '/services/authservice/api/invitations/INV-1'],
      ['post', '/services/authservice/api/invitations/INV-1/redeem'],
      ['get', '/services/authservice/api/profile/tokens'],
      ['get', '/services/uiservice/theme.css'],
      ['post', '/services/filing/api/upload/a.txt'],
      ['get', '/services/logging/scripts'],
      ['get', '/services/caching/api/status'],
      ['head', '/services/caching/api/status'],
      ['get', '/services/caching/views/app.js']
    ])('lets %s %s through', async (method, url) => {
      await request(app)[method](url).expect(200);
    });

    it.each([
      ['get', '/services/authservice/api/invitations'],
      ['post', '/services/authservice/api/invitations/batch'],
      ['post', '/services/caching/api/status'],
      ['delete', '/services/caching/api/delete/key.js'],
      ['post', '/services/caching/api/put/key.css'],
      ['put', '/services/workflow/api/definitions/flow.js']
    ])('guards %s %s', async (method, url) => {
      await request(app)[method](url).set('Accept', 'application/json').expect(401);
    });
  });

  describe('Passport sessions', () => {
    it('admits admins and rejects other roles', async () => {
      await request(makeApp({ user: { roles: ['admin'] } })).get('/services/caching/api/list').expect(200);
      const res = await request(makeApp({ user: { role: 'user' } })).get('/services/caching/api/list').expect(403);
      expect(res.body.error).toBe('Insufficient privileges');
      const html = await request(makeApp({ user: { roles: ['user'] } })).get('/services/').set('Accept', 'text/html').expect(302);
      expect(html.headers.location).toBe('/services/authservice/views/invalid.html');
    });
  });

  describe('API keys', () => {
    it('prefers admin keys over general keys when configured', async () => {
      const app = makeApp({ registry: { globalOptions: { adminApiKeys: ['admin-key'], apiKeys: ['general-key'] } } });
      const ok = await request(app).get('/services/caching/api/list').set('x-api-key', 'admin-key').expect(200);
      expect(ok.body.apiKey).toBe('admin-key');
      await request(app).get('/services/caching/api/list').set('x-api-key', 'general-key').expect(401);
    });

    it('falls back to general keys and reads the security config', async () => {
      const app = makeApp({ registry: { securityConfig: { apiKeyAuth: { apiKeys: ['general-key'] } } } });
      await request(app).get('/services/caching/api/list').set('api-key', 'general-key').expect(200);
      await request(app).get('/services/caching/api/list').set('Authorization', 'ApiKey general-key').expect(200);

      const adminCfg = makeApp({ registry: { securityConfig: { servicesAuth: { apiKeys: ['portal-key'] } } } });
      await request(adminCfg).get('/services/caching/api/list').set('x-api-key', 'portal-key').expect(200);
    });

    it('does not accept keys in the query string', async () => {
      const app = makeApp({ registry: { globalOptions: { apiKeys: ['general-key'] } } });
      await request(app).get('/services/caching/api/list?api_key=general-key').set('Accept', 'application/json').expect(401);
    });
  });

  describe('session tokens', () => {
    const app = makeApp();

    it('admits admin tokens from the Authorization header only', async () => {
      const res = await request(app).get('/services/caching/api/list').set('Authorization', 'Bearer admin-token').expect(200);
      expect(res.body.user).toEqual(expect.objectContaining({ email: 'admin@x.com', roles: ['admin'] }));
      // Query-string tokens are never accepted (feature 23).
      await request(app).get('/services/caching/api/list?authToken=admin-token').expect(401);
    });

    it('admits an admin token stored on the session and stores new tokens', async () => {
      const session = { authToken: 'admin-token' };
      await request(makeApp({ session })).get('/services/caching/api/list').expect(200);
      const fresh = {};
      await request(makeApp({ session: fresh })).get('/services/caching/api/list?authToken=admin-token').expect(401);
      expect(fresh.authToken).toBeUndefined();
    });

    it('rejects non-admin and invalid tokens', async () => {
      await request(app).get('/services/caching/api/list').set('Authorization', 'Bearer user-token').expect(403);
      await request(app).get('/services/caching/api/list').set('Authorization', 'Bearer nope').set('Accept', 'application/json').expect(401);
    });
  });

  describe('login pages', () => {
    it('redirects an already-authenticated admin away from the login page', async () => {
      // The redirect now needs the Authorization header, not a query token.
      const login = await request(makeApp()).get('/services/authservice/login').set('Authorization', 'Bearer admin-token').expect(302);
      expect(login.headers.location).toBe('/services/');
      await request(makeApp()).get('/services/authservice/login').query({ authToken: 'admin-token' }).expect(200);
      await request(makeApp()).get('/services/authservice/login').set('Authorization', 'Bearer user-token').expect(200);
      await request(makeApp()).get('/services/authservice/login').set('Authorization', 'Bearer bad').expect(200);
      await request(makeApp()).get('/services/authservice/register').expect(200);
    });
  });

  describe('unauthenticated browsers', () => {
    it('serves a token-checking page for HTML GETs', async () => {
      const res = await request(makeApp()).get('/services/caching/').set('Accept', 'text/html').expect(200);
      expect(res.text).toContain('Checking authentication');
    });

    it('redirects other HTML requests to the login page with a return URL', async () => {
      const res = await request(makeApp()).post('/services/caching/api/list').set('Accept', 'text/html').expect(302);
      expect(res.headers.location).toBe('/services/authservice/views/login.html?returnUrl=%2Fservices%2Fcaching%2Fapi%2Flist');
    });

    it('fails closed when the auth service throws', async () => {
      const app = makeApp({ registry: { authservice: () => { throw new Error('down'); }, globalOptions: undefined } });
      await request(app).get('/services/caching/api/list').set('Authorization', 'Bearer admin-token').set('Accept', 'application/json').expect(401);
    });
  });
});
