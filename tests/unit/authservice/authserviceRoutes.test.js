/**
 * @fileoverview Unit tests for the authservice REST API.
 *
 * Mounts the memory auth provider on a bare Express application and exercises
 * login/logout/validate, password helpers, user and role management, profile
 * password and token endpoints, invitations, status/branding/SSO config and
 * settings, including authentication guards and login lock-out.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

// Low bcrypt cost keeps the suite fast; set before the authservice loads.
process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createAuth = require('../../../src/authservice');

const PASSWORD = 'Str0ng!Pass#2026';

describe('Authservice routes', () => {
  let app;
  let auth;
  let token;
  const loggedIn = [];

  /** Adds a bearer token to a supertest request. */
  const as = (req, t = token) => req.set('Authorization', `Bearer ${t}`);

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    // Stand-in for Passport's logIn, which this harness does not mount.
    app.use((req, _res, next) => {
      if (typeof req.logIn !== 'function') {
        req.logIn = (user, cb) => { loggedIn.push(user.email); cb(null); };
      }
      next();
    });
    loggedIn.length = 0;
    auth = createAuth('memory', { 'express-app': app }, new EventEmitter());
    await auth.createUser({ email: 'admin@x.com', fullName: 'Admin', password: PASSWORD, role: 'admin' });
    const login = await request(app)
      .post('/services/authservice/api/login')
      .send({ email: 'admin@x.com', password: PASSWORD, returnUrl: '/services/caching' })
      .expect(200);
    expect(login.body.redirectUrl).toBe('/services/caching');
    token = login.body.data.session.token;
  });

  it('rejects direct registration', async () => {
    await request(app).post('/services/authservice/api/register').send({}).expect(403);
  });

  it('rejects bad credentials and validates login input', async () => {
    await request(app).post('/services/authservice/api/login').send({ email: 'admin@x.com', password: 'wrong' }).expect(401);
    await request(app).post('/services/authservice/api/login').send({ email: 'admin@x.com' }).expect(400);
    await request(app)
      .post('/services/authservice/api/login')
      .send({ email: 'admin@x.com', password: PASSWORD, returnUrl: '//evil.test' })
      .expect(400);
  });

  it('locks an account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/services/authservice/api/login').send({ email: 'admin@x.com', password: 'nope' }).expect(401);
    }
    const locked = await request(app).post('/services/authservice/api/login').send({ email: 'admin@x.com', password: PASSWORD }).expect(429);
    expect(locked.headers['retry-after']).toBeDefined();
  });

  it('validates sessions and logs out', async () => {
    const ok = await request(app).post('/services/authservice/api/validate').send({ token }).expect(200);
    expect(ok.body.success).toBe(true);
    const bad = await request(app).post('/services/authservice/api/validate').send({ token: 'bad' }).expect(200);
    expect(bad.body.success).toBe(false);

    await as(request(app).post('/services/authservice/api/logout')).send({}).expect(200);
    const after = await request(app).post('/services/authservice/api/validate').send({ token }).expect(200);
    expect(after.body.success).toBe(false);

    await request(app).get('/services/authservice/logout').expect(302);
  });

  it('validates and generates passwords', async () => {
    const weak = await request(app).post('/services/authservice/api/auth/password/validate').send({ password: 'weak' }).expect(200);
    expect(weak.body.data.valid).toBe(false);
    const strong = await request(app).post('/services/authservice/api/auth/password/validate').send({ password: PASSWORD }).expect(200);
    expect(strong.body.data.valid).toBe(true);
    await request(app).post('/services/authservice/api/auth/password/validate').send({}).expect(400);
    const gen = await request(app).get('/services/authservice/api/auth/password/generate').expect(200);
    expect(gen.body.data.password.length).toBeGreaterThanOrEqual(10);
  });

  it('requires authentication for management routes', async () => {
    await request(app).get('/services/authservice/api/users').expect(401);
    await as(request(app).get('/services/authservice/api/users'), 'not-a-token').expect(401);
    await request(app).get('/services/authservice/api/roles').expect(401);
    await request(app).get('/services/authservice/api/profile/tokens').expect(401);
  });

  it('manages users', async () => {
    await as(request(app).post('/services/authservice/api/users'))
      .send({ email: 'u@x.com', fullName: 'U', password: PASSWORD })
      .expect(201);
    const list = await as(request(app).get('/services/authservice/api/users')).expect(200);
    expect(list.body.total).toBe(2);
    const one = await as(request(app).get('/services/authservice/api/users/u@x.com')).expect(200);
    expect(one.body.data.fullName).toBe('U');
    expect(one.body.data.password).toBeUndefined();

    await as(request(app).put('/services/authservice/api/users/u@x.com')).send({ fullName: 'U2' }).expect(200);
    await as(request(app).post('/services/authservice/api/users/u@x.com/role')).send({ role: 'editor' }).expect(200);
    expect((await auth.getUser('u@x.com')).roles).toContain('editor');

    const batch = await as(request(app).post('/services/authservice/api/users/batch'))
      .send({ users: [{ email: 'b1@x.com', fullName: 'B', password: PASSWORD }] })
      .expect(200);
    expect(batch.body.data.created).toHaveLength(1);
    await as(request(app).post('/services/authservice/api/users/batch')).send({ users: 'x' }).expect(400);

    await as(request(app).delete('/services/authservice/api/users/u@x.com')).expect(200);
  });

  it('manages roles', async () => {
    await as(request(app).post('/services/authservice/api/roles')).send({ roleName: 'auditor' }).expect(201);
    const roles = await as(request(app).get('/services/authservice/api/roles')).expect(200);
    expect(roles.body.data).toContain('auditor');

    await auth.createUser({ email: 'r@x.com', fullName: 'R', password: PASSWORD });
    const assigned = await as(request(app).put('/services/authservice/api/roles/auditor/users'))
      .send({ emails: ['r@x.com'] })
      .expect(200);
    expect(assigned.body.data.assigned).toEqual(['r@x.com']);
    await as(request(app).put('/services/authservice/api/roles/auditor/users')).send({}).expect(400);

    const members = await as(request(app).get('/services/authservice/api/roles/auditor/users')).expect(200);
    expect(members.body.data.map((u) => u.email)).toEqual(['r@x.com']);
  });

  it('exchanges a session token for a session login, and refuses a bad token', async () => {
    const before = loggedIn.length;
    const ok = await request(app).post('/services/authservice/api/session/exchange').send({ token }).expect(200);
    expect(ok.body.success).toBe(true);
    expect(loggedIn.length).toBe(before + 1);
    expect(loggedIn[loggedIn.length - 1]).toBe('admin@x.com');

    await request(app).post('/services/authservice/api/session/exchange').send({ token: 'nope' }).expect(401);
    await request(app).post('/services/authservice/api/session/exchange').send({}).expect(400);
  });

  it('lets an admin revoke a user\'s token, and refuses a non-admin', async () => {
    await auth.createUser({ email: 'owner@x.com', fullName: 'Owner', password: PASSWORD });
    const owner = await auth.authenticateUser('owner@x.com', PASSWORD);
    const made = await auth.createApiToken('owner@x.com', 'ci', { expiresInDays: 7 });

    await as(request(app).delete(`/services/authservice/api/users/owner@x.com/tokens/${made.id}`)).expect(200);
    await expect(auth.validateApiToken(made.token)).rejects.toThrow();
    await auth.validateSession(owner.session.token).catch(() => {});

    const ownerToken = owner.session.token;
    await request(app).delete(`/services/authservice/api/users/owner@x.com/tokens/${made.id}`)
      .set('Authorization', `Bearer ${ownerToken}`).expect(403);
  });

  it('changes the caller\'s password and manages API tokens', async () => {
    await as(request(app).put('/services/authservice/api/profile/password'))
      .send({ currentPassword: PASSWORD, newPassword: 'An0ther!Pass#2026' })
      .expect(200);

    // Changing the password ends every existing session (feature 23), so sign in again.
    const relogin = await request(app).post('/services/authservice/api/login')
      .send({ email: 'admin@x.com', password: 'An0ther!Pass#2026' }).expect(200);
    token = relogin.body.data.session.token;

    const created = await as(request(app).post('/services/authservice/api/profile/tokens')).send({ name: 'ci' }).expect(201);
    expect(created.body.data.token).toMatch(/^dtk_/);
    const list = await as(request(app).get('/services/authservice/api/profile/tokens')).expect(200);
    expect(list.body.total).toBe(1);
    await as(request(app).delete(`/services/authservice/api/profile/tokens/${created.body.data.id}`)).expect(200);
  });

  it('holds public requests for approval, then issues, recreates and redeems codes', async () => {
    // A public request creates a pending invitation and never returns a code.
    const requested = await request(app)
      .post('/services/authservice/api/invitations')
      .send({ name: 'New', email: 'new@x.com' })
      .expect(201);
    expect(requested.body.data.status).toBe('pending');
    expect(requested.body.data.code).toBeUndefined();
    const id = requested.body.data.id;

    // Pending requests have no usable code, so the public status check reports 404 for guesses.
    await request(app).get('/services/authservice/api/invitations/INV-NOPE').expect(404);

    // The admin list never includes a code or its hash.
    const listed = await as(request(app).get('/services/authservice/api/invitations')).expect(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.data[0].codeHash).toBeUndefined();
    expect(listed.body.data[0].code).toBeUndefined();

    // An administrator approves by id and receives the code once.
    const approved = await as(request(app).put(`/services/authservice/api/invitations/${id}/approve`)).send({}).expect(200);
    const code = approved.body.data.code;
    expect(code).toMatch(/^INV-[0-9A-F]{32}$/);
    await as(request(app).put(`/services/authservice/api/invitations/${id}/approve`)).send({}).expect(409);

    const status = await request(app).get(`/services/authservice/api/invitations/${code}`).expect(200);
    expect(status.body.data).toEqual(expect.objectContaining({ status: 'approved', email: 'new@x.com' }));

    const batch = await as(request(app).post('/services/authservice/api/invitations/batch'))
      .send({ invites: [{ name: 'B', email: 'b@x.com' }] })
      .expect(200);
    expect(batch.body.success).toBe(true);
    expect(batch.body.data.created[0].code).toMatch(/^INV-/);
    await as(request(app).post('/services/authservice/api/invitations/batch')).send({}).expect(400);

    // Recreating issues a new code and invalidates the old one.
    const recreated = await as(request(app).post(`/services/authservice/api/invitations/${id}/recreate`)).send({}).expect(200);
    const newCode = recreated.body.data.code;
    expect(newCode).not.toBe(code);
    await request(app).get(`/services/authservice/api/invitations/${code}`).expect(404);
    await as(request(app).post('/services/authservice/api/invitations/INV-NOPE/recreate')).send({}).expect(404);

    // The old code cannot redeem; the new one creates the account exactly once.
    await request(app)
      .post(`/services/authservice/api/invitations/${code}/redeem`)
      .send({ password: PASSWORD })
      .expect(400);
    const redeemed = await request(app)
      .post(`/services/authservice/api/invitations/${newCode}/redeem`)
      .send({ password: PASSWORD })
      .expect(201);
    expect(redeemed.body.data.email).toBe('new@x.com');
    await request(app).post(`/services/authservice/api/invitations/${newCode}/redeem`).send({ password: PASSWORD }).expect(400);

    await as(request(app).post(`/services/authservice/api/invitations/${id}/recreate`)).send({}).expect(409);
  });

  it('refuses invitation administration to a signed-in non-admin', async () => {
    await auth.createUser({ email: 'member@x.com', fullName: 'Member', password: PASSWORD, role: 'user' });
    const login = await request(app)
      .post('/services/authservice/api/login')
      .send({ email: 'member@x.com', password: PASSWORD })
      .expect(200);
    const memberToken = login.body.data.session.token;

    await as(request(app).get('/services/authservice/api/invitations'), memberToken).expect(403);
    await as(request(app).post('/services/authservice/api/invitations/batch'), memberToken)
      .send({ invites: [{ name: 'X', email: 'x@x.com' }] })
      .expect(403);
  });

  it('serves status, branding, SSO config and settings', async () => {
    const status = await request(app).get('/services/authservice/api/status').expect(200);
    expect(status.body.data.provider).toBe('memory');
    const branding = await request(app).get('/services/authservice/api/branding').expect(200);
    expect(branding.body.data.appName).toBe('NooblyJS');
    const sso = await request(app).get('/services/authservice/api/sso-config').expect(200);
    expect(sso.body.data.enabled).toBe(false);
    await as(request(app).get('/services/authservice/api/settings')).expect(200);
    await as(request(app).post('/services/authservice/api/settings')).send({}).expect(200);
  });
});
