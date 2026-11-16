/**
 * @fileoverview Regression test: measuring routes refuse a date segment that is not a date.
 *
 * GET /services/measuring/api/total/:metric/:datestart/:dateend used to pass an
 * Invalid Date into the provider, which reported 0 without any error. Such a
 * request now gets 400 with a message that names the bad value.
 *
 * @author NooblyJS Team
 * @since 1.2.0
 */

'use strict';

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createMeasuring = require('../../../src/measuring');

describe('Measuring routes: date segments', () => {
  let app;
  let measuring;
  const from = encodeURIComponent(new Date(Date.now() - 60000).toISOString());
  const to = encodeURIComponent(new Date(Date.now() + 60000).toISOString());

  beforeEach(() => {
    app = express();
    app.use(express.json());
    measuring = createMeasuring('default', { 'express-app': app }, new EventEmitter());
    measuring.add('visits', 4);
  });

  afterEach(() => {
    measuring.analytics?.destroy?.();
  });

  it('answers with the total for valid ISO dates', async () => {
    const res = await request(app).get(`/services/measuring/api/total/visits/${from}/${to}`).expect(200);
    expect(res.body).toBe(4);
  });

  it('refuses a start date that is not a date with 400', async () => {
    const res = await request(app).get(`/services/measuring/api/total/visits/none/${to}`).expect(400);
    expect(res.body.error).toMatch(/Invalid date: none/);
  });

  it('refuses an end date that is not a date on the list route', async () => {
    await request(app).get(`/services/measuring/api/list/visits/${from}/not-a-date`).expect(400);
  });

  it('refuses an invalid date on the average route', async () => {
    await request(app).get(`/services/measuring/api/average/visits/${from}/nope`).expect(400);
  });
});
