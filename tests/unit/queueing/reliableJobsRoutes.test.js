/**
 * @fileoverview HTTP surface for reliable jobs (feature 06).
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');
const createQueue = require('../../../src/queueing');

describe('reliable jobs routes', () => {
  let app;
  let queue;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    queue = createQueue('memory', { 'express-app': app }, new EventEmitter());
  });

  it('enqueues a job and reports its state', async () => {
    const created = await request(app)
      .post('/services/queueing/api/queues/emails/jobs')
      .send({ data: { to: 'a' }, options: { attempts: 2, priority: 'high' } })
      .expect(201);
    const id = created.body.data.id;

    const job = await request(app).get(`/services/queueing/api/queues/emails/jobs/${id}`).expect(200);
    expect(job.body.data).toEqual(expect.objectContaining({ id, state: 'waiting', maxAttempts: 2, priority: 'high', data: { to: 'a' } }));
    await request(app).get('/services/queueing/api/queues/emails/jobs/nope').expect(404);
  });

  it('refuses unknown options with a 400', async () => {
    const res = await request(app)
      .post('/services/queueing/api/queues/emails/jobs')
      .send({ data: {}, options: { retries: 3 } })
      .expect(400);
    expect(res.body.error).toMatch(/Unknown job option "retries"/);
  });

  it('dead-letters a job after its last attempt, then requeues it', async () => {
    const created = await request(app)
      .post('/services/queueing/api/queues/emails/jobs')
      .send({ data: {}, options: { attempts: 1, backoff: { type: 'fixed', baseMs: 0, maxMs: 0 } } })
      .expect(201);
    const id = created.body.data.id;

    const consumer = queue.process('emails', async () => { throw new Error('smtp down'); }, { pollIntervalMs: 5 });
    for (let i = 0; i < 400; i += 1) {
      const job = await queue.getJob(id, 'emails');
      if (job.state === 'dead') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    await consumer.stop();

    const dead = await request(app).get(`/services/queueing/api/queues/emails/jobs/${id}`).expect(200);
    expect(dead.body.data).toEqual(expect.objectContaining({ state: 'dead', lastError: 'smtp down' }));

    const counts = await request(app).get('/services/queueing/api/queues/emails/job-counts').expect(200);
    expect(counts.body.data.dead).toBe(1);

    const retry = await request(app).post('/services/queueing/api/queues/emails/retry-dead').expect(200);
    expect(retry.body.data.requeued).toBe(1);
    const back = await request(app).get(`/services/queueing/api/queues/emails/jobs/${id}`).expect(200);
    expect(back.body.data).toEqual(expect.objectContaining({ state: 'waiting', attempts: 0 }));
  });

  it('refuses reliable options on a provider without a job store', async () => {
    const aws = createQueue('aws', { 'express-app': express() }, new EventEmitter());
    await expect(aws.enqueue('x', {}, { attempts: 2 })).rejects.toThrow(/not supported by the aws queueing provider/);
    expect(() => aws.process('x', async () => {})).toThrow(/not supported/);
  });
});
