/**
 * @fileoverview Regression tests for the filing exploit chain (review
 * 2026-11-12, findings C-1 and L-3; feature 15).
 *
 * The reproduced chain was: a plain signed-in user repointed the filing root
 * with POST /settings { baseDir }, then read a file outside it. These tests
 * drive the real filing router with a caller identity taken from headers and
 * assert that every step is refused.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createFiling = require('../../../src/filing');
const { testDataDir } = require('../../helpers/testData');

const ADMIN_KEY = 'admin-scoped-key-for-tests';
const DATA_KEY = 'data-plane-key-for-tests';

/**
 * Builds an app whose caller identity comes from request headers, so each
 * test can act as a user, an editor, an admin or an API key holder.
 *
 * @param {string} baseDir - Filing storage root
 * @param {Object} [registryOptions] - Extra registry settings (admin keys)
 * @return {express.Application}
 */
function buildApp(baseDir, registryOptions = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.text());
  app.use((req, _res, next) => {
    const roles = req.headers['x-test-roles'];
    if (roles) req.user = { email: 'caller@test.local', roles: roles.split(',') };
    if (req.headers['x-test-key']) req.apiKey = req.headers['x-test-key'];
    next();
  });
  const registry = {
    globalOptions: registryOptions.globalOptions || {},
    securityConfig: registryOptions.securityConfig || {},
    getServiceInstance: () => null,
    listInstances: () => []
  };
  createFiling('local', { 'express-app': app, baseDir, ServiceRegistry: registry }, new EventEmitter());
  return app;
}

const asUser = (req) => req.set('x-test-roles', 'user');
const asEditor = (req) => req.set('x-test-roles', 'editor');
const asAdmin = (req) => req.set('x-test-roles', 'admin');

describe('Security regression: filing authorization (C-1, L-3)', () => {
  let root;
  let outside;
  let app;

  beforeEach(() => {
    const base = testDataDir('security-filing');
    root = fs.mkdtempSync(path.join(base, 'store-'));
    outside = fs.mkdtempSync(path.join(base, 'outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET-CONTENT');
    fs.writeFileSync(path.join(root, 'public.txt'), 'hello');
    app = buildApp(root, { globalOptions: { adminApiKeys: [ADMIN_KEY] } });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('refuses a plain user the settings route that repointed the root', async () => {
    const res = await asUser(request(app).post('/services/filing/api/settings'))
      .send({ baseDir: outside })
      .expect(403);
    expect(res.body.success).toBe(false);
  });

  it('refuses an admin attempt to change the storage root at runtime', async () => {
    const res = await asAdmin(request(app).post('/services/filing/api/settings'))
      .send({ baseDir: outside })
      .expect(400);
    expect(res.text).toMatch(/fixed when the filing instance is created/);
  });

  it('never reads outside the storage root, even after a refused repoint', async () => {
    await asAdmin(request(app).post('/services/filing/api/settings')).send({ baseDir: outside });

    const traversal = await asUser(request(app).get('/services/filing/api/download/../' + path.basename(outside) + '/secret.txt'));
    expect(traversal.status).not.toBe(200);
    expect(JSON.stringify(traversal.body) + traversal.text).not.toContain('TOP-SECRET-CONTENT');

    // The encoded form reaches the containment check intact, so it must be refused with 400.
    const encoded = await asUser(request(app).get('/services/filing/api/download/..%2F' + path.basename(outside) + '%2Fsecret.txt'));
    expect(encoded.status).toBe(400);
    expect(encoded.text).not.toContain('TOP-SECRET-CONTENT');
  });

  it('lets any signed-in user read documents in the store', async () => {
    const res = await asUser(request(app).get('/services/filing/api/download/public.txt?encoding=utf8')).expect(200);
    expect(res.body).toEqual({ data: 'hello', encoding: 'utf8' });
  });

  it('stops a plain user from writing or deleting files', async () => {
    await asUser(request(app).post('/services/filing/api/upload/new.txt').set('Content-Type', 'text/plain'))
      .send('x')
      .expect(403);
    await asUser(request(app).delete('/services/filing/api/remove/public.txt')).expect(403);
    expect(fs.existsSync(path.join(root, 'public.txt'))).toBe(true);
  });

  it('lets an editor write, and an admin delete', async () => {
    await asEditor(request(app).post('/services/filing/api/upload/new.txt').set('Content-Type', 'text/plain'))
      .send('written')
      .expect(200);
    expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('written');
    await asAdmin(request(app).delete('/services/filing/api/remove/new.txt')).expect(200);
  });

  it('keeps git, sync, instances and analytics to admins', async () => {
    const adminOnly = [
      ['get', '/services/filing/api/instances'],
      ['get', '/services/filing/api/analytics'],
      ['post', '/services/filing/api/git/push'],
      ['post', '/services/filing/api/git/commit'],
      ['post', '/services/filing/api/sync/push'],
      ['post', '/services/filing/api/sync/auto/start']
    ];
    for (const [method, url] of adminOnly) {
      const res = await asEditor(request(app)[method](url)).send({});
      expect({ url, status: res.status }).toEqual({ url, status: 403 });
    }
  });

  it('does not let a data-plane API key reach admin operations', async () => {
    const res = await request(app)
      .post('/services/filing/api/settings')
      .set('x-test-key', DATA_KEY)
      .send({ maxFileSize: 1024 });
    expect(res.status).toBe(403);
  });

  it('lets an admin-scoped API key reach admin operations', async () => {
    await request(app)
      .post('/services/filing/api/settings')
      .set('x-test-key', ADMIN_KEY)
      .send({ maxFileSize: 1024 })
      .expect(200);
  });

  it('does not fall back to data-plane keys when no admin keys are configured', async () => {
    const noAdminKeys = buildApp(root, {});
    await request(noAdminKeys)
      .post('/services/filing/api/settings')
      .set('x-test-key', DATA_KEY)
      .send({ maxFileSize: 1024 })
      .expect(403);
  });

  it('rejects unknown and fixed settings and keeps the allow-listed values', async () => {
    await asAdmin(request(app).post('/services/filing/api/settings')).send({ key: 'value' }).expect(400);
    await asAdmin(request(app).post('/services/filing/api/settings')).send({ allowedTypes: 'html' }).expect(200);
    const settings = await asAdmin(request(app).get('/services/filing/api/settings')).expect(200);
    expect(settings.body.allowedTypes).toBe('html');
  });
});
