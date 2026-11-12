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

  /** Adds a bearer token to a supertest request. */
  const as = (req, t = token) => req.set('Authorization', `Bearer ${t}`);

  beforeEach(async () => {
    app = express();
    app.use(express.json());
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

  it('changes the caller\'s password and manages API tokens', async () => {
    await as(request(app).put('/services/authservice/api/profile/password'))
      .send({ currentPassword: PASSWORD, newPassword: 'An0ther!Pass#2026' })
      .expect(200);

    // Feature 23: a password change ends every existing session.
    await as(request(app).get('/services/authservice/api/profile/tokens')).set('Accept', 'application/json').expect(401);
    const relogin = await request(app)
      .post('/services/authservice/api/login')
      .send({ email: 'admin@x.com', password: 'An0ther!Pass#2026' })
      .expect(200);
    token = relogin.body.data.session.token;

    const created = await as(request(app).post('/services/authservice/api/profile/tokens')).send({ name: 'ci' }).expect(201);
    expect(created.body.data.token).toMatch(/^dtk_/);
    const list = await as(request(app).get('/services/authservice/api/profile/tokens')).expect(200);
    expect(list.body.total).toBe(1);
    await as(request(app).delete(`/services/authservice/api/profile/tokens/${created.body.data.id}`)).expect(200);
  });

  it('issues, approves, recreates and redeems invitations', async () => {
    // A public request is held for approval and never returns a code.
    const requested = await request(app)
      .post('/services/authservice/api/invitations')
      .send({ name: 'New', email: 'new@x.com' })
      .expect(202);
    expect(requested.body.data.status).toBe('pending');
    expect(requested.body.data.code).toBeUndefined();

    const all = await as(request(app).get('/services/authservice/api/invitations')).expect(200);
    expect(all.body.total).toBe(1);
    const pending = all.body.data[0];
    expect(pending.status).toBe('pending');
    expect(pending.code).toBeUndefined();
    expect(pending.codeHash).toBeUndefined();

    // An admin approves it and receives the code once.
    const approved = await as(request(app).put(`/services/authservice/api/invitations/${pending.id}/approve`)).send({}).expect(200);
    const code = approved.body.data.code;
    expect(code).toMatch(/^INV-[0-9A-F]{20}$/);
    await as(request(app).put(`/services/authservice/api/invitations/${pending.id}/approve`)).send({}).expect(400);
    await as(request(app).put('/services/authservice/api/invitations/nope/approve')).send({}).expect(404);

    const public_ = await request(app).get(`/services/authservice/api/invitations/${code}`).expect(200);
    expect(public_.body.data.email).toBe('new@x.com');
    await request(app).get('/services/authservice/api/invitations/INV-NOPE').expect(404);

    // An admin creating an invitation from the dashboard gets the code directly.
    const created = await as(request(app).post('/services/authservice/api/invitations'))
      .send({ name: 'Direct', email: 'direct@x.com' })
      .expect(201);
    expect(created.body.data.code).toMatch(/^INV-/);

    const batch = await as(request(app).post('/services/authservice/api/invitations/batch'))
      .send({ invites: [{ name: 'B', email: 'b@x.com' }] })
      .expect(200);
    expect(batch.body.success).toBe(true);
    expect(batch.body.data.created[0].code).toMatch(/^INV-/);
    await as(request(app).post('/services/authservice/api/invitations/batch')).send({}).expect(400);

    const recreated = await as(request(app).post(`/services/authservice/api/invitations/${pending.id}/recreate`)).send({}).expect(200);
    const newCode = recreated.body.data.code;
    expect(newCode).not.toBe(code);
    await as(request(app).post('/services/authservice/api/invitations/INV-NOPE/recreate')).send({}).expect(400);
    // The old code stopped working when the invitation was recreated.
    await request(app).post(`/services/authservice/api/invitations/${code}/redeem`).send({ password: PASSWORD }).expect(400);

    const redeemed = await request(app)
      .post(`/services/authservice/api/invitations/${newCode}/redeem`)
      .send({ fullName: 'New', password: PASSWORD })
      .expect(201);
    expect(redeemed.body.data.email).toBe('new@x.com');
    await request(app).post(`/services/authservice/api/invitations/${newCode}/redeem`).send({ fullName: 'New', password: PASSWORD }).expect(400);

    await as(request(app).post(`/services/authservice/api/invitations/${pending.id}/recreate`)).send({}).expect(400);
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
