'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('node:events');
const createSettings = require('../../../src/settings');
const { testDataDir } = require('../../helpers/testData');

describe('Feature flag routes (feature 13)', () => {
  let tempDir;
  let app;
  let settings;
  let emitter;

  /**
   * Builds an app whose auth middleware sets the caller from a test header, so
   * each test can act as a user, an editor or an anonymous caller.
   */
  const buildApp = () => {
    const server = express();
    server.use(express.json());
    server.use((req, res, next) => {
      const role = req.headers['x-test-role'];
      if (role) {
        req.user = { id: req.headers['x-test-id'] || 'u-1', email: `${req.headers['x-test-id'] || 'u-1'}@example.com`, roles: [role] };
      }
      next();
    });
    settings = createSettings('file', {
      filepath: path.join(tempDir, 'settings.enc.json'),
      secret: 'route-test-secret',
      refreshMs: 0,
      'express-app': server
    }, emitter);
    return server;
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(testDataDir('flags'), 'nooblyjs-flag-routes-'));
    emitter = new EventEmitter();
    app = buildApp();
  });

  afterEach(() => {
    settings.flags.destroy();
    emitter.removeAllListeners();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves a flag, lists it and deletes it', async () => {
    const saved = await request(app)
      .put('/services/settings/api/flags/checkout')
      .send({ enabled: true, rolloutPercent: 100, description: 'New checkout' })
      .expect(200);
    expect(saved.body.flag).toMatchObject({ name: 'checkout', enabled: true, rolloutPercent: 100 });

    const listed = await request(app).get('/services/settings/api/flags').expect(200);
    expect(listed.body.flags.map((f) => f.name)).toEqual(['checkout']);

    const removed = await request(app).delete('/services/settings/api/flags/checkout').expect(200);
    expect(removed.body.deleted).toBe(true);
  });

  it('rejects an invalid definition with a 400 and a message that is safe to show', async () => {
    const res = await request(app)
      .put('/services/settings/api/flags/checkout')
      .send({ rolloutPercent: 500 })
      .expect(400);
    expect(res.body.error).toMatch(/^Invalid flag: rolloutPercent/);
  });

  it('evaluates for the signed-in caller, not for roles or ids sent in the body', async () => {
    await request(app)
      .put('/services/settings/api/flags/editors-only')
      .send({ enabled: true, rolloutPercent: 0, rules: [{ type: 'role', values: ['editor'] }] })
      .expect(200);

    const asUser = await request(app)
      .post('/services/settings/api/flags/editors-only/evaluate')
      .set('x-test-role', 'user')
      .send({ roles: ['editor'] })
      .expect(200);
    expect(asUser.body).toMatchObject({ success: true, enabled: false });

    const asEditor = await request(app)
      .post('/services/settings/api/flags/editors-only/evaluate')
      .set('x-test-role', 'editor')
      .send({})
      .expect(200);
    expect(asEditor.body).toMatchObject({ enabled: true, reason: 'rule:role' });
  });

  it('answers an unknown flag as off', async () => {
    const res = await request(app)
      .post('/services/settings/api/flags/never-defined/evaluate')
      .set('x-test-role', 'user')
      .expect(200);
    expect(res.body).toMatchObject({ enabled: false, reason: 'unknown' });
  });
});
