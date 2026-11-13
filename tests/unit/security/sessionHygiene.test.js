/**
 * @fileoverview Regression tests for session and token hygiene (review
 * 2026-11-12, finding M-2; feature 23).
 *
 * Covers: revocation on role, password and activation changes; the admin idle
 * timeout; the same-origin check on cookie-authenticated writes; and the
 * default 90-day lifetime of personal access tokens.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createAuth = require('../../../src/authservice');
const { createServicesAuthMiddleware } = require('../../../src/authservice/middleware/services');

const PASSWORD = 'Str0ng!Pass#2026';
const NEW_PASSWORD = 'An0ther!Pass#2026';

describe('Security regression: session and token hygiene (M-2)', () => {
  let auth;

  beforeEach(async () => {
    auth = createAuth('memory', { 'express-app': express() }, new EventEmitter());
    await auth.createUser({ email: 'admin@x.com', fullName: 'Admin', password: PASSWORD, role: 'admin' });
    await auth.createUser({ email: 'user@x.com', fullName: 'User', password: PASSWORD, role: 'user' });
  });

  it('ends a session when the user role changes', async () => {
    const { session } = await auth.authenticateUser('user@x.com', PASSWORD);
    await expect(auth.validateSession(session.token)).resolves.toBeDefined();

    await auth.updateUser('user@x.com', { roles: ['editor'] });
    await expect(auth.validateSession(session.token)).rejects.toThrow(/Invalid session|Session revoked/);
  });

  it('ends every session when the password changes', async () => {
    const first = await auth.authenticateUser('user@x.com', PASSWORD);
    const second = await auth.authenticateUser('user@x.com', PASSWORD);

    await auth.changePassword('user@x.com', PASSWORD, NEW_PASSWORD);

    await expect(auth.validateSession(first.session.token)).rejects.toThrow(/Invalid session|Session revoked/);
    await expect(auth.validateSession(second.session.token)).rejects.toThrow(/Invalid session|Session revoked/);
    // A fresh login with the new password works.
    const fresh = await auth.authenticateUser('user@x.com', NEW_PASSWORD);
    await expect(auth.validateSession(fresh.session.token)).resolves.toBeDefined();
  });

  it('ends sessions when the account is deactivated', async () => {
    const { session } = await auth.authenticateUser('user@x.com', PASSWORD);
    await auth.updateUser('user@x.com', { isActive: false });
    await expect(auth.validateSession(session.token)).rejects.toThrow(/Invalid session|Session revoked/);
  });

  it('expires an idle admin session after the admin timeout', async () => {
    const { session } = await auth.authenticateUser('admin@x.com', PASSWORD);
    auth.sessionIdleMs_.admin = 20; // shorten the 30-minute default for the test

    await new Promise((r) => setTimeout(r, 40));
    await expect(auth.validateSession(session.token)).rejects.toThrow('inactivity');
  });

  it('keeps an active session alive by touching it on each use', async () => {
    const { session } = await auth.authenticateUser('admin@x.com', PASSWORD);
    // A wide idle window: the sleeps must stay well inside it even on a loaded machine.
    auth.sessionIdleMs_.admin = 400;

    for (let i = 0; i < 4; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      await expect(auth.validateSession(session.token)).resolves.toBeDefined();
    }
  });

  it('issues personal access tokens that expire after 90 days by default', async () => {
    const created = await auth.createApiToken('user@x.com', 'ci');
    const days = (created.expiresAt - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it('lets an admin revoke another user\'s token', async () => {
    const created = await auth.createApiToken('user@x.com', 'ci', { expiresInDays: 30 });
    await expect(auth.validateApiToken(created.token)).resolves.toBeDefined();

    await auth.deleteApiToken('user@x.com', created.id);
    await expect(auth.validateApiToken(created.token)).rejects.toThrow();
  });

  it('sends a no-referrer policy with the app\'s helmet configuration', async () => {
    const helmet = require('helmet');
    const { helmetCspOption } = require('../../../src/shared/utils/contentSecurityPolicy');
    const app = express();
    app.use(helmet({ contentSecurityPolicy: helmetCspOption() }));
    app.get('/', (_req, res) => res.send('ok'));
    const res = await request(app).get('/').expect(200);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('Security regression: cross-origin writes with a session cookie (M-2)', () => {
  /** Builds a guarded app where the caller is an authenticated admin with a cookie session. */
  function appFor(user) {
    const registry = {
      authservice: () => ({ validateSession: async () => { throw new Error('invalid'); } }),
      globalOptions: {},
      securityConfig: {}
    };
    const app = express();
    app.use((req, _res, next) => {
      req.user = user;
      req.isAuthenticated = () => true;
      next();
    });
    app.use('/services', createServicesAuthMiddleware(registry));
    app.all('/services/*', (_req, res) => res.json({ reached: true }));
    return app;
  }

  const admin = { email: 'admin@x.com', roles: ['admin'] };

  it('refuses a write whose Origin is another site', async () => {
    const res = await request(appFor(admin))
      .post('/services/caching/api/set')
      .set('Host', 'portal.example.com')
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(res.body.code).toBe('CROSS_ORIGIN');
  });

  it('allows a write from the same origin, a request without Origin, and reads from anywhere', async () => {
    await request(appFor(admin))
      .post('/services/caching/api/set')
      .set('Host', 'portal.example.com')
      .set('Origin', 'https://portal.example.com')
      .expect(200);
    await request(appFor(admin)).post('/services/caching/api/set').expect(200);
    await request(appFor(admin))
      .get('/services/caching/api/list')
      .set('Host', 'portal.example.com')
      .set('Origin', 'https://evil.example')
      .expect(200);
  });
});
