/**
 * @fileoverview Core's routes under /services read JSON bodies; initialize() parses them itself, so a host app without
 * a global express.json() (NooblyJS Cloud parses per router) still works, and one with it is unaffected.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');

describe('JSON bodies on core\'s /services routes', () => {
  afterEach(async () => {
    const registry = require('../../index');
    await registry.shutdown?.();
    registry.reset?.();
  });

  const start = (hostParses) => {
    const registry = require('../../index');
    const app = express();
    if (hostParses) app.use(express.json());
    registry.initialize(app, new EventEmitter(), { security: { servicesAuth: { requireLogin: false } } });
    app.post('/services/probe/echo', (req, res) => res.json({ body: req.body ?? null }));
    app.post('/elsewhere/echo', (req, res) => res.json({ body: req.body ?? null }));
    return app;
  };

  it('parses them when the host app has no express.json()', async () => {
    const app = start(false);
    const res = await request(app).post('/services/probe/echo').send({ invites: [{ name: 'Ada', email: 'ada@x.test' }] });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ invites: [{ name: 'Ada', email: 'ada@x.test' }] });
    // Only core's own paths: the host's other routes are the host's business.
    expect((await request(app).post('/elsewhere/echo').send({ a: 1 })).body.body).toBeNull();
  });

  it('leaves a body the host already parsed as it is', async () => {
    const app = start(true);
    const res = await request(app).post('/services/probe/echo').send({ a: 1 });
    expect(res.body.body).toEqual({ a: 1 });
  });
});
