/**
 * @fileoverview Unit tests for the settings service REST API.
 *
 * Mounts the settings service on a bare Express application and exercises the
 * group, value, statistics and configuration endpoints, including secret
 * masking and error status codes.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createSettings = require('../../../src/settings');
const { testDataDir } = require('../../helpers/testData');

describe('Settings routes', () => {
  /** @type {express.Application} Express app with the settings service mounted */
  let app;
  /** @type {string} Temporary directory holding the encrypted file */
  let tempDir;
  /** @type {Object} Settings service, stopped in afterAll */
  let settingsService;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(testDataDir('settings'), 'nooblyjs-settings-routes-'));
    app = express();
    app.use(express.json());

    settingsService = createSettings('file', {
      'express-app': app,
      filepath: path.join(tempDir, 'settings.enc.json'),
      secret: 'route-test-secret',
      dependencies: {}
    }, new EventEmitter());
  });

  afterAll(() => {
    settingsService?.flags?.destroy?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should report service status', async () => {
    await request(app).get('/services/settings/api/status').expect(200);
  });

  it('should create a group and manage its values', async () => {
    await request(app)
      .post('/services/settings/api/groups')
      .send({ name: 'smtp', description: 'Mail server' })
      .expect(201);

    await request(app)
      .post('/services/settings/api/values/smtp/password')
      .send({ value: 'hunter2', secret: true, type: 'string' })
      .expect(200);

    const masked = await request(app)
      .get('/services/settings/api/groups/smtp')
      .expect(200);
    expect(masked.body.group.entries[0]).toEqual(expect.objectContaining({
      key: 'password',
      value: '********',
      secret: true
    }));

    const revealed = await request(app)
      .get('/services/settings/api/groups/smtp?reveal=true')
      .expect(200);
    expect(revealed.body.group.entries[0].value).toBe('hunter2');

    const single = await request(app)
      .get('/services/settings/api/values/smtp/password')
      .expect(200);
    expect(single.body.value).toBe('********');

    const groups = await request(app)
      .get('/services/settings/api/groups')
      .expect(200);
    expect(groups.body.groups.map((group) => group.name))
      .toEqual(expect.arrayContaining(['default', 'smtp']));

    const statistics = await request(app)
      .get('/services/settings/api/statistics')
      .expect(200);
    expect(statistics.body.statistics.secrets).toBe(1);

    const all = await request(app)
      .get('/services/settings/api/values')
      .expect(200);
    expect(all.body.values.smtp.password).toBe('********');
  });

  it('should import values and update a group description', async () => {
    await request(app)
      .post('/services/settings/api/values')
      .send({ values: { database: { host: 'localhost', port: 5432 } } })
      .expect(200);

    const database = await request(app)
      .get('/services/settings/api/values/database/port')
      .expect(200);
    expect(database.body.value).toBe(5432);

    const updated = await request(app)
      .put('/services/settings/api/groups/database')
      .send({ description: 'Primary database' })
      .expect(200);
    expect(updated.body.group.description).toBe('Primary database');
  });

  it('should expose the provider configuration without the master secret', async () => {
    const configuration = await request(app)
      .get('/services/settings/api/settings')
      .expect(200);

    expect(configuration.body.list.map((setting) => setting.setting))
      .toEqual(['filepath', 'autosave', 'maskSecrets']);
    expect(JSON.stringify(configuration.body)).not.toContain('route-test-secret');

    await request(app)
      .post('/services/settings/api/settings')
      .send({ maskSecrets: 'true' })
      .expect(200);
  });

  it('should reload the store from disk', async () => {
    await request(app).post('/services/settings/api/reload').expect(200);

    const value = await request(app)
      .get('/services/settings/api/values/database/host?reveal=true')
      .expect(200);
    expect(value.body.value).toBe('localhost');
  });

  it('should delete values and groups', async () => {
    await request(app)
      .delete('/services/settings/api/values/smtp/password')
      .expect(200);
    await request(app)
      .delete('/services/settings/api/groups/smtp')
      .expect(200);

    await request(app).get('/services/settings/api/groups/smtp').expect(404);
  });

  it('should return meaningful error statuses', async () => {
    await request(app).get('/services/settings/api/groups/unknown').expect(404);
    await request(app).get('/services/settings/api/values/default/unknown').expect(404);
    await request(app).delete('/services/settings/api/values/default/unknown').expect(404);

    await request(app)
      .post('/services/settings/api/values/default/key')
      .send({})
      .expect(400);
    await request(app)
      .post('/services/settings/api/groups')
      .send({})
      .expect(400);
    await request(app)
      .post('/services/settings/api/groups')
      .send({ name: 'bad/name' })
      .expect(400);
  });

  it('should serve the admin screen', async () => {
    const page = await request(app).get('/services/settings/').expect(200);
    expect(page.text).toContain('Settings Management');
  });
});
