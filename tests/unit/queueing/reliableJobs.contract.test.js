/**
 * @fileoverview Contract tests for reliable jobs (feature 06). The same cases
 * run against the memory store and, when RUN_REDIS_TESTS=1, the Redis store.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const { ReliableJobs, normalizeEnqueueOptions } = require('../../../src/queueing/modules/reliableJobs');
const { MemoryJobStore } = require('../../../src/queueing/modules/memoryJobStore');
const { createRedisJobStore } = require('../../../src/queueing/modules/redisJobStore');
const { ClientError } = require('../../../src/shared/utils/httpErrors');

const REDIS_ENABLED = process.env.RUN_REDIS_TESTS === '1';
const REDIS_PORT = Number(process.env.REDIS_TEST_PORT || 6379);

/** Waits until a condition holds, polling in real time. */
async function waitFor(check, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Builds the engine on a store, with a clock the test controls. */
function makeEngine(store) {
  const clock = { t: 1_700_000_000_000 };
  let n = 0;
  const engine = new ReliableJobs(store, { clock: () => clock.t, idFn: () => `job_${++n}` });
  return { engine, clock };
}

const SUITES = [
  { name: 'memory store', create: async () => ({ store: new MemoryJobStore(), close: async () => {} }) }
];

if (REDIS_ENABLED) {
  SUITES.push({
    name: 'redis store',
    create: async () => {
      const Redis = require('ioredis');
      const client = new Redis({ host: '127.0.0.1', port: REDIS_PORT, keyPrefix: 'nooblyjs-test:', lazyConnect: true, maxRetriesPerRequest: 2 });
      await client.connect();
      return { store: createRedisJobStore(client), close: async () => client.quit() };
    }
  });
}

describe.each(SUITES)('reliable jobs contract: $name', ({ create }) => {
  let ctx;
  let queue;
  let consumers;

  beforeEach(async () => {
    ctx = await create();
    const made = makeEngine(ctx.store);
    ctx.engine = made.engine;
    ctx.clock = made.clock;
    queue = `q${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    consumers = [];
  });

  afterEach(async () => {
    await Promise.all(consumers.map((c) => c.stop()));
    await ctx.close();
  });

  const fast = { pollIntervalMs: 5 };

  it('runs a job and records it completed', async () => {
    const { id } = await ctx.engine.enqueue(queue, { to: 'a' });
    const seen = [];
    consumers.push(ctx.engine.process(queue, async (job) => { seen.push(job.data); }, fast));
    await waitFor(async () => (await ctx.engine.getJob(id, queue))?.state === 'completed');
    expect(seen).toEqual([{ to: 'a' }]);
    expect((await ctx.engine.getJob(id, queue)).attempts).toBe(1);
  });

  it('retries with exponential backoff until the job succeeds', async () => {
    const { id } = await ctx.engine.enqueue(queue, {}, { attempts: 3, backoff: { type: 'exponential', baseMs: 1000, maxMs: 60000 } });
    let calls = 0;
    consumers.push(ctx.engine.process(queue, async () => {
      calls += 1;
      if (calls < 3) throw new Error(`boom ${calls}`);
    }, fast));

    await waitFor(async () => (await ctx.engine.getJob(id, queue))?.state === 'failed');
    // The first retry is due 1 s after the failure; the clock has not moved, so it waits.
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);

    ctx.clock.t += 1000;
    await waitFor(async () => (await ctx.engine.getJob(id, queue))?.state === 'failed' && calls === 2);
    ctx.clock.t += 2000; // second retry: 2 s after the second failure
    await waitFor(async () => (await ctx.engine.getJob(id, queue))?.state === 'completed');
    expect(calls).toBe(3);
    expect((await ctx.engine.getJob(id, queue)).lastError).toBe('boom 2');
  });

  it('moves a job to dead letters after its last attempt and requeues it on request', async () => {
    const { id } = await ctx.engine.enqueue(queue, {}, { attempts: 2, backoff: { type: 'fixed', baseMs: 0, maxMs: 0 } });
    let fail = true;
    consumers.push(ctx.engine.process(queue, async () => { if (fail) throw new Error('nope'); }, fast));

    await waitFor(async () => (await ctx.engine.getJob(id, queue))?.state === 'dead');
    expect((await ctx.engine.getJob(id, queue)).attempts).toBe(2);
    expect(await ctx.engine.counts(queue)).toEqual(expect.objectContaining({ dead: 1, completed: 0 }));

    fail = false;
    expect(await ctx.engine.retryDeadLetters(queue)).toBe(1);
    await waitFor(async () => (await ctx.engine.getJob(id, queue))?.state === 'completed');
    expect((await ctx.engine.getJob(id, queue)).attempts).toBe(1);
  });

  it('holds a delayed job until its time comes', async () => {
    const { id } = await ctx.engine.enqueue(queue, {}, { delayMs: 60000 });
    let ran = 0;
    consumers.push(ctx.engine.process(queue, async () => { ran += 1; }, fast));
    await new Promise((r) => setTimeout(r, 30));
    expect(ran).toBe(0);
    expect((await ctx.engine.getJob(id, queue)).state).toBe('delayed');

    ctx.clock.t += 60000;
    await waitFor(() => ran === 1);
  });

  it('returns the original id for a repeated idempotency key within the window', async () => {
    const first = await ctx.engine.enqueue(queue, { n: 1 }, { idempotencyKey: `welcome:${queue}` });
    const second = await ctx.engine.enqueue(queue, { n: 2 }, { idempotencyKey: `welcome:${queue}` });
    expect(second).toEqual({ id: first.id, deduplicated: true });
    expect((await ctx.engine.counts(queue)).waiting).toBe(1);
  });

  it('redelivers a job whose consumer died before acknowledging it', async () => {
    const { id } = await ctx.engine.enqueue(queue, { k: 1 }, { attempts: 3, backoff: { type: 'fixed', baseMs: 0, maxMs: 0 } });
    // A consumer claims the job and vanishes: it never acks or fails.
    const lost = await ctx.store.claim(queue, ctx.clock.t, 30000);
    expect(lost.id).toBe(id);

    // Before the lease ends nobody else gets it.
    expect(await ctx.store.claim(queue, ctx.clock.t + 1000, 30000)).toBeNull();

    // After the lease ends a live consumer receives it again, with a second attempt.
    ctx.clock.t += 30001;
    let got = null;
    consumers.push(ctx.engine.process(queue, async (job) => { got = job; }, fast));
    await waitFor(() => got !== null);
    expect(got.id).toBe(id);
    expect(got.attempts).toBe(2);
  });

  it('delivers higher priority jobs first', async () => {
    await ctx.engine.enqueue(queue, 'low', { priority: 'low' });
    await ctx.engine.enqueue(queue, 'normal', {});
    await ctx.engine.enqueue(queue, 'high', { priority: 'high' });
    const order = [];
    consumers.push(ctx.engine.process(queue, async (job) => { order.push(job.data); }, fast));
    await waitFor(() => order.length === 3);
    expect(order).toEqual(['high', 'normal', 'low']);
  });

  it('lets in-flight jobs finish when the consumer stops', async () => {
    const { id } = await ctx.engine.enqueue(queue, {});
    let release;
    const gate = new Promise((r) => { release = r; });
    const consumer = ctx.engine.process(queue, async () => { await gate; }, fast);
    await waitFor(() => consumer.inFlight() === 1);

    const stopping = consumer.stop();
    release();
    await stopping;
    expect((await ctx.engine.getJob(id, queue)).state).toBe('completed');
  });
});

describe('reliable jobs options', () => {
  it('rejects unknown and out-of-range options with a client error', () => {
    expect(() => normalizeEnqueueOptions({ retries: 3 })).toThrow(ClientError);
    expect(() => normalizeEnqueueOptions({ attempts: 0 })).toThrow(/attempts/);
    expect(() => normalizeEnqueueOptions({ backoff: { type: 'linear' } })).toThrow(/backoff.type/);
    expect(() => normalizeEnqueueOptions({ priority: 'urgent' })).toThrow(/priority/);
    expect(() => normalizeEnqueueOptions({ delayMs: -1 })).toThrow(/delayMs/);
  });

  it('fills in defaults', () => {
    const o = normalizeEnqueueOptions({});
    expect(o).toEqual(expect.objectContaining({ attempts: 3, priority: 'normal', delayMs: 0, idempotencyKey: null }));
  });
});
