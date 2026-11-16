/**
 * @fileoverview REST routes for outbound webhooks (feature 12): list, create,
 * delete, publish, deliveries and redeliver, over real HTTP via supertest.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('node:events');
const createQueue = require('../../../src/queueing');
const createSettings = require('../../../src/settings');
const createNotifying = require('../../../src/notifying');
const { testDataDir } = require('../../helpers/testData');

const PUBLIC_URL = 'https://93.184.216.34/hooks';

describe('webhook REST routes (feature 12)', () => {
  let dir;
  let app;
  let emitter;
  let notifying;
  let settingsService;
  let queueService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(testDataDir('webhook-routes'), 'nooblyjs-wh-routes-'));
    emitter = new EventEmitter();
    queueService = createQueue('memory', { dependencies: {} }, emitter);
    settingsService = createSettings('file', {
      filepath: path.join(dir, 'settings.enc.json'),
      secret: 'webhook-routes-secret',
      flagsRefreshMs: 0
    }, emitter);
    app = express();
    app.use(express.json());
    notifying = createNotifying('default', {
      'express-app': app,
      instanceName: 'default',
      dependencies: { logging: undefined, queueing: queueService, settings: settingsService },
      webhooks: { attempts: 1, backoff: { type: 'fixed', baseMs: 5, maxMs: 5 } }
    }, emitter);
  });

  afterEach(async () => {
    await notifying.stopConsumers?.();
    settingsService.flags?.destroy?.();
    emitter.removeAllListeners();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates a subscription, returns its secret once, and lists it masked', async () => {
    const created = await request(app)
      .post('/services/notifying/api/webhooks')
      .send({ url: PUBLIC_URL, events: ['order.created'], description: 'orders' })
      .expect(201);
    expect(created.body.id).toMatch(/^wh_/);
    expect(created.body.secret).toMatch(/^whsec_/);

    const listed = await request(app).get('/services/notifying/api/webhooks').expect(200);
    expect(listed.body.subscriptions).toHaveLength(1);
    expect(listed.body.subscriptions[0].secret).not.toBe(created.body.secret);
    expect(listed.body.subscriptions[0]).toMatchObject({ id: created.body.id, description: 'orders' });
  });

  it('rejects an invalid subscription with a 400 and a readable reason', async () => {
    const res = await request(app).post('/services/notifying/api/webhooks').send({ url: PUBLIC_URL }).expect(400);
    expect(res.body.error).toMatch(/events is required/);
  });

  it('refuses a private-network URL with a 400, not a 500', async () => {
    await request(app)
      .post('/services/notifying/api/webhooks')
      .send({ url: 'http://127.0.0.1/hook', events: ['*'] })
      .expect(400);
  });

  it('deletes a subscription, and 404s on an unknown id', async () => {
    const created = await request(app).post('/services/notifying/api/webhooks').send({ url: PUBLIC_URL, events: ['*'] }).expect(201);
    await request(app).delete(`/services/notifying/api/webhooks/${created.body.id}`).expect(200);
    await request(app).delete(`/services/notifying/api/webhooks/${created.body.id}`).expect(404);
  });

  it('publishes an event to matching subscriptions and reports how many were queued', async () => {
    await request(app).post('/services/notifying/api/webhooks').send({ url: PUBLIC_URL, events: ['order.created'] }).expect(201);
    await request(app).post('/services/notifying/api/webhooks').send({ url: PUBLIC_URL, events: ['user.deleted'] }).expect(201);
    const res = await request(app)
      .post('/services/notifying/api/webhooks/publish')
      .send({ event: 'order.created', data: { id: 7 } })
      .expect(202);
    expect(res.body).toEqual({ queued: 1, eventId: expect.stringMatching(/^evt_/) });
  });

  it('validates the publish body', async () => {
    await request(app).post('/services/notifying/api/webhooks/publish').send({}).expect(400);
    await request(app).post('/services/notifying/api/webhooks/publish').send({ event: 'bad event!' }).expect(400);
  });

  it('lists deliveries without bodies, and validates the limit', async () => {
    const res = await request(app).get('/services/notifying/api/webhooks/deliveries?limit=5').expect(200);
    expect(res.body.deliveries).toEqual([]);
    await request(app).get('/services/notifying/api/webhooks/deliveries?limit=0').expect(400);
    await request(app).get('/services/notifying/api/webhooks/deliveries?limit=9999').expect(400);
  });

  it('redelivers an unknown delivery as a 404', async () => {
    await request(app).post('/services/notifying/api/webhooks/deliveries/del_missing/redeliver').expect(404);
  });

  it('requires a login when auth middleware is configured', async () => {
    const guarded = express();
    guarded.use(express.json());
    const emitter2 = new EventEmitter();
    const svc = createNotifying('default', {
      'express-app': guarded,
      authMiddleware: (req, res) => res.status(401).json({ error: 'no' }),
      dependencies: { queueing: queueService, settings: settingsService },
      webhooks: {}
    }, emitter2);
    await request(guarded).get('/services/notifying/api/webhooks').expect(401);
    await svc.stopConsumers?.();
    emitter2.removeAllListeners();
  });
});
