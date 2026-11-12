'use strict';

/**
 * @fileoverview Reliable jobs contract (feature 06): the same behaviour on
 * every job store. Runs on the memory store and on Redis through
 * ioredis-mock; set REDIS_TEST_URL (e.g. redis://127.0.0.1:6379) to also run
 * it against a real Redis server.
 */

const { EventEmitter } = require('events');
const { MemoryJobStore, RedisJobStore } = require('../../../src/queueing/modules/jobStores');
const { ReliableJobs, backoffDelay } = require('../../../src/queueing/modules/reliableJobs');
const { attachJobs } = require('../../../src/queueing/modules/attachJobs');
const createQueue = require('../../../src/queueing');

const waitFor = async (check, timeoutMs = 3000, stepMs = 10) => {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
};

const stores = [['memory', async () => ({ store: new MemoryJobStore(), close: async () => {} })]];

stores.push(['redis (ioredis-mock)', async () => {
  const RedisMock = require('ioredis-mock');
  const client = new RedisMock({ keyPrefix: 'queue:' });
  await client.flushall();
  return { store: new RedisJobStore(client, { namespace: `t${Date.now()}${Math.random()}` }), close: async () => client.disconnect() };
}]);

if (process.env.REDIS_TEST_URL) {
  stores.push(['redis (server)', async () => {
    const Redis = require('ioredis');
    const client = new Redis(process.env.REDIS_TEST_URL, { keyPrefix: 'queue:' });
    return {
      store: new RedisJobStore(client, { namespace: `contract:${Date.now()}:${Math.random()}` }),
      close: async () => client.quit()
    };
  }]);
}

describe.each(stores)('reliable jobs on %s', (_name, makeStore) => {
  let jobs;
  let store;
  let close;
  let events;
  const consumers = [];

  const start = (queue, handler, options) => {
    const c = jobs.process(queue, handler, { pollMs: 10, ...options });
    consumers.push(c);
    return c;
  };

  beforeEach(async () => {
    ({ store, close } = await makeStore());
    events = new EventEmitter();
    jobs = new ReliableJobs(store, { backoff: { type: 'fixed', baseMs: 10 } }, { eventEmitter: events, instanceName: 't' });
  });

  afterEach(async () => {
    await Promise.all(consumers.splice(0).map((c) => c.stop({ timeoutMs: 100 })));
    await close();
  });

  it('completes a job and records the result', async () => {
    const id = await jobs.add('q', { n: 1 }, {});
    start('q', async (job) => ({ doubled: job.data.n * 2 }));
    const job = await waitFor(async () => {
      const j = await jobs.getJob(id);
      return j.state === 'completed' && j;
    });
    expect(job.result).toEqual({ doubled: 2 });
    expect(job.attempts).toBe(1);
  });

  it('retries with backoff and moves the job to the dead-letter list after its attempts', async () => {
    const times = [];
    const dead = [];
    events.on('queue:job:dead:t', (e) => dead.push(e));
    const id = await jobs.add('q', {}, { attempts: 3, backoff: { type: 'exponential', baseMs: 40, maxMs: 1000 } });
    start('q', async () => {
      times.push(Date.now());
      throw new Error('boom');
    });
    await waitFor(async () => (await jobs.getJob(id)).state === 'dead');
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(35);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(75);
    const job = await jobs.getJob(id);
    expect(job).toMatchObject({ attempts: 3, lastError: 'boom' });
    expect((await jobs.listDeadLetters('q')).map((j) => j.id)).toEqual([id]);
    expect(dead).toHaveLength(1);
    expect((await jobs.counts('q')).dead).toBe(1);
  });

  it('retryDeadLetters gives dead jobs fresh attempts', async () => {
    let fail = true;
    const id = await jobs.add('q', {}, { attempts: 1 });
    start('q', async () => {
      if (fail) throw new Error('first time');
    });
    await waitFor(async () => (await jobs.getJob(id)).state === 'dead');
    fail = false;
    expect(await jobs.retryDeadLetters('q')).toBe(1);
    await waitFor(async () => (await jobs.getJob(id)).state === 'completed');
    expect(await jobs.listDeadLetters('q')).toEqual([]);
  });

  it('delays a job until delayMs has passed', async () => {
    const ran = [];
    const added = Date.now();
    const id = await jobs.add('q', {}, { delayMs: 150 });
    expect((await jobs.getJob(id)).state).toBe('delayed');
    expect((await jobs.counts('q')).delayed).toBe(1);
    start('q', async () => ran.push(Date.now()));
    await waitFor(() => ran.length === 1);
    expect(ran[0] - added).toBeGreaterThanOrEqual(145);
  });

  it('drops duplicates with the same idempotency key', async () => {
    let runs = 0;
    const a = await jobs.add('q', { v: 1 }, { idempotencyKey: 'welcome:1' });
    const b = await jobs.add('q', { v: 2 }, { idempotencyKey: 'welcome:1' });
    const c = await jobs.add('q', { v: 3 }, { idempotencyKey: 'welcome:2' });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    start('q', async () => { runs += 1; });
    await waitFor(async () => (await jobs.getJob(c)).state === 'completed' && (await jobs.getJob(a)).state === 'completed');
    expect(runs).toBe(2);
  });

  it('redelivers a job whose consumer died', async () => {
    const id = await jobs.add('q', {}, {});
    // A consumer claims it and dies without acking.
    expect(await store.claim('q', Date.now(), Date.now() + 50)).toBe(id);
    const ran = [];
    start('q', async (job) => ran.push(job.id), { visibilityTimeoutMs: 100 });
    await waitFor(() => ran.length === 1);
    expect(ran).toEqual([id]);
  });

  it('does not redeliver a slow job that is still running', async () => {
    let runs = 0;
    const id = await jobs.add('q', {}, {});
    start('q', async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 300));
    }, { visibilityTimeoutMs: 100, concurrency: 2 });
    await waitFor(async () => (await jobs.getJob(id)).state === 'completed');
    expect(runs).toBe(1);
  });

  it('takes high priority jobs first', async () => {
    const order = [];
    await jobs.add('q', 'low', { priority: 'low' });
    await jobs.add('q', 'normal', {});
    await jobs.add('q', 'high', { priority: 'high' });
    start('q', async (job) => order.push(job.data));
    await waitFor(() => order.length === 3);
    expect(order).toEqual(['high', 'normal', 'low']);
  });

  it('stop() finishes in-flight jobs; a timed-out stop hands them back', async () => {
    let release;
    const id = await jobs.add('q', {}, {});
    const c = jobs.process('q', () => new Promise((r) => { release = r; }), { pollMs: 10 });
    await waitFor(() => release);
    const stopping = c.stop({ timeoutMs: 1000 });
    release();
    await stopping;
    expect((await jobs.getJob(id)).state).toBe('completed');

    const id2 = await jobs.add('q', {}, {});
    let started = false;
    const c2 = jobs.process('q', () => { started = true; return new Promise(() => {}); }, { pollMs: 10 });
    await waitFor(() => started);
    await c2.stop({ timeoutMs: 20 });
    const back = await jobs.getJob(id2);
    expect(back.state).toBe('waiting');
    expect(back.attempts).toBe(0);
  });

  it('refuses unknown options and bad values', async () => {
    await expect(jobs.add('q', {}, { retries: 3 })).rejects.toThrow('Unknown job option "retries"');
    await expect(jobs.add('q', {}, { priority: 'urgent' })).rejects.toThrow('priority');
    await expect(jobs.add('q', {}, { attempts: 0 })).rejects.toThrow('attempts');
  });
});

describe('backoffDelay', () => {
  it('doubles from baseMs up to maxMs, or stays fixed', () => {
    const exp = { type: 'exponential', baseMs: 100, maxMs: 500 };
    expect([1, 2, 3, 4].map((n) => backoffDelay(exp, n))).toEqual([100, 200, 400, 500]);
    expect(backoffDelay({ type: 'fixed', baseMs: 250 }, 5)).toBe(250);
  });
});

describe('queue service integration', () => {
  const events = new EventEmitter();
  let queue;
  const consumers = [];

  beforeEach(() => {
    queue = createQueue('memory', { dependencies: {}, jobs: { pollMs: 10 } }, events);
  });

  afterEach(async () => {
    await queue.stopConsumers({ timeoutMs: 100 });
    queue.analytics?.destroy?.();
  });

  it('keeps plain enqueue/dequeue unchanged', async () => {
    expect(await queue.enqueue('plain', { a: 1 })).toBeUndefined();
    expect(await queue.dequeue('plain')).toEqual({ a: 1 });
  });

  it('enqueue with options returns a job id; process() also drains plain items', async () => {
    const seen = [];
    const id = await queue.enqueue('mail', { to: 'a' }, { attempts: 2 });
    expect(id).toMatch(/^job_/);
    await queue.enqueue('mail', { to: 'b' });
    consumers.push(queue.process('mail', async (job) => seen.push(job.data.to), { pollMs: 10 }));
    await waitFor(() => seen.length === 2);
    expect(seen.sort()).toEqual(['a', 'b']);
    expect((await queue.getJob(id)).state).toBe('completed');
    expect(await queue.jobCounts('mail')).toMatchObject({ waiting: 0, active: 0, processed: expect.objectContaining({ completed: 2 }) });
  });

  it('providers without a job store fail loudly', async () => {
    const fake = { enqueue: async () => {}, dequeue: async () => undefined };
    attachJobs(fake, 'rabbitmq', {}, events);
    expect(fake.supportsJobs).toBe(false);
    expect(() => fake.process('q', () => {})).toThrow('not supported by the "rabbitmq" queue provider');
    await expect(fake.enqueue('q', {}, { attempts: 2 })).rejects.toThrow('not supported');
    await expect(fake.enqueue('q', {})).resolves.toBeUndefined();
  });

  it('registry shutdown drains consumers', async () => {
    const registry = require('../../../index');
    registry.reset();
    registry.initialize(require('express')(), new EventEmitter(), { apiKeys: [], requireApiKey: false, security: { servicesAuth: { requireLogin: false } } });
    const q = registry.queue('memory', { jobs: { pollMs: 10 } });
    let release;
    const id = await q.enqueue('s', {}, {});
    q.process('s', () => new Promise((r) => { release = r; }));
    await waitFor(() => release);
    setTimeout(() => release(), 50);
    await registry.shutdown();
    expect((await q.getJob(id)).state).toBe('completed');
    registry.reset();
  });
});

describe('job routes', () => {
  const express = require('express');
  const request = require('supertest');
  const { permissionFor } = require('../../../src/authservice/policy/routePermissions');
  let app;
  let queue;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    queue = createQueue('memory', { 'express-app': app, dependencies: {}, jobs: { pollMs: 10 } }, new EventEmitter());
  });

  afterEach(async () => {
    await queue.stopConsumers({ timeoutMs: 100 });
    queue.analytics?.destroy?.();
  });

  it('enqueues a job with options, shows it, lists and retries dead letters', async () => {
    const res = await request(app).post('/services/queueing/api/enqueue/mail')
      .send({ task: { to: 'x' }, options: { attempts: 1 } }).expect(200);
    expect(res.body.jobId).toMatch(/^job_/);
    await request(app).post('/services/queueing/api/enqueue/mail').send({ task: { a: 1 }, options: { bogus: 1 } }).expect(400);

    const job = await request(app).get(`/services/queueing/api/jobs/mail/job/${res.body.jobId}`).expect(200);
    expect(job.body.state).toBe('waiting');

    queue.process('mail', async () => { throw new Error('nope'); }, { pollMs: 10 });
    await waitFor(async () => (await queue.getJob(res.body.jobId)).state === 'dead');
    const dead = await request(app).get('/services/queueing/api/jobs/mail/dead').expect(200);
    expect(dead.body.jobs.map((j) => j.id)).toEqual([res.body.jobId]);
    const list = await request(app).get('/services/queueing/api/jobs').expect(200);
    expect(list.body.queues).toEqual([expect.objectContaining({ name: 'mail', dead: 1 })]);

    await queue.stopConsumers({ timeoutMs: 100 });
    const retried = await request(app).post('/services/queueing/api/jobs/mail/dead/retry').send({}).expect(200);
    expect(retried.body.retried).toBe(1);
    await request(app).delete(`/services/queueing/api/jobs/mail/job/${res.body.jobId}`).expect(200);
    await request(app).get(`/services/queueing/api/jobs/mail/job/${res.body.jobId}`).expect(404);
    await request(app).get('/services/queueing/api/jobs/bad%20name/counts').expect(400);
  });

  it('job routes have permissions: read to look, write to change', () => {
    expect(permissionFor('GET', '/queueing/api/jobs/mail/dead')).toBe('queue:read');
    expect(permissionFor('POST', '/queueing/api/jobs/mail/dead/retry')).toBe('queue:write');
    expect(permissionFor('DELETE', '/queueing/api/jobs/mail/job/x')).toBe('queue:write');
  });
});

if (process.env.REDIS_TEST_URL) {
  describe('redis queue provider (server)', () => {
    it('runs jobs through the provider\'s own client', async () => {
      const url = new URL(process.env.REDIS_TEST_URL);
      const q = createQueue('redis', { dependencies: {}, redisurl: url.hostname, redisport: Number(url.port) || 6379, jobs: { pollMs: 10 } }, new EventEmitter());
      const name = `provider-${Date.now()}`;
      const id = await q.enqueue(name, { n: 1 }, { attempts: 2, backoff: { type: 'fixed', baseMs: 20 } });
      let calls = 0;
      q.process(name, async (job) => { calls += 1; if (job.attempts === 1) throw new Error('once'); });
      await waitFor(async () => (await q.getJob(id)).state === 'completed');
      expect(calls).toBe(2);
      await q.stopConsumers();
      await q.disconnect();
      q.analytics?.destroy?.();
    });
  });
}
