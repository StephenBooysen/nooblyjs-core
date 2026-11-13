/**
 * @fileoverview Completion-callback correlation for the working service.
 *
 * A caller's `completionCallback` used to be a property of the task object put
 * on the queue. That works only while the queue hands back the very same object
 * — true of the in-memory provider, false of every out-of-process one. The
 * ActiveMQ provider enqueues with `JSON.stringify` and dequeues with
 * `JSON.parse`, and JSON silently drops function-valued properties, so the task
 * completed with no callback to fire. Nothing then settled the promise
 * `WorkflowService` awaits and every workflow hung after its first step, with no
 * error logged anywhere.
 *
 * These tests pin the contract that replaced it: nothing unserialisable goes on
 * the queue, the callback is correlated back by task id, and a result that never
 * arrives fails loudly rather than hanging.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const EventEmitter = require('node:events');
const WorkerManager = require('../../../src/working/providers/working');

/**
 * An in-memory queue that mimics a BROKER rather than a local Map: every item
 * makes a JSON round trip, exactly as the ActiveMQ provider does. This is the
 * whole point — a queue that stores by reference cannot reproduce the bug.
 */
class JsonRoundTripQueue {
  constructor() {
    this.queues = new Map();
  }
  queueFor_(name) {
    if (!this.queues.has(name)) this.queues.set(name, []);
    return this.queues.get(name);
  }
  async enqueue(name, item) {
    this.queueFor_(name).push(JSON.stringify(item));
  }
  async dequeue(name) {
    const raw = this.queueFor_(name).shift();
    return raw === undefined ? undefined : JSON.parse(raw);
  }
  async size(name) {
    return this.queueFor_(name).length;
  }
}

/** Builds a manager that never actually spawns a worker thread. */
function makeManager(queueService, options = {}) {
  const manager = new WorkerManager(
    { dependencies: { queueing: queueService }, enableLogging: false, allowAbsolutePaths: true, ...options },
    new EventEmitter()
  );
  // The queue processor is not wanted in most tests — drive it explicitly.
  manager.stopQueueProcessor_();
  return manager;
}

const SCRIPT = path.resolve(__dirname, 'noop.script.js');

describe('working — the enqueued task must survive serialisation', () => {
  let queue;
  let manager;

  beforeEach(() => {
    queue = new JsonRoundTripQueue();
    manager = makeManager(queue);
  });

  afterEach(async () => {
    manager.stopQueueProcessor_();
    manager.isRunning_ = false;
  });

  test('no function is placed on the queue', async () => {
    await manager.start(SCRIPT, { a: 1 }, () => {});

    const queued = await queue.dequeue(manager.QUEUE_INCOMING_);
    expect(queued).toBeDefined();
    expect(queued.completionCallback).toBeUndefined();
    // …and the parts a remote worker genuinely needs did survive.
    expect(queued.scriptPath).toBe(SCRIPT);
    expect(queued.data).toEqual({ a: 1 });
    expect(queued.origin).toBe(manager.originId_);
  });

  test('the callback is retained in-process, keyed by task id', async () => {
    const taskId = await manager.start(SCRIPT, {}, () => {});

    expect(manager.pendingCallbacks_.has(taskId)).toBe(true);
    expect(typeof manager.pendingCallbacks_.get(taskId).callback).toBe('function');
  });

  test('a fire-and-forget caller registers no waiter', async () => {
    await manager.start(SCRIPT, {});
    expect(manager.pendingCallbacks_.size).toBe(0);
  });

  test('a failed enqueue does not strand a waiter', async () => {
    queue.enqueue = async () => { throw new Error('broker unreachable'); };

    await expect(manager.start(SCRIPT, {}, () => {})).rejects.toThrow('broker unreachable');
    expect(manager.pendingCallbacks_.size).toBe(0);
  });
});

describe('working — local settlement', () => {
  let queue;
  let manager;

  beforeEach(() => {
    queue = new JsonRoundTripQueue();
    manager = makeManager(queue);
  });

  afterEach(() => { manager.isRunning_ = false; });

  test('fires the callback when this process both queued and ran the task', async () => {
    const seen = [];
    const taskId = await manager.start(SCRIPT, {}, (status, data) => seen.push([status, data]));
    const task = await queue.dequeue(manager.QUEUE_INCOMING_);

    await manager.finaliseTask_(
      { task, startedAt: new Date(), finalised: false, timeoutHandle: null },
      'completed',
      { ok: true }
    );

    expect(seen).toEqual([['completed', { ok: true }]]);
    expect(manager.pendingCallbacks_.has(taskId)).toBe(false);
  });

  test('propagates an error status to the callback', async () => {
    const seen = [];
    await manager.start(SCRIPT, {}, (status, data) => seen.push([status, data]));
    const task = await queue.dequeue(manager.QUEUE_INCOMING_);

    await manager.finaliseTask_(
      { task, startedAt: new Date(), finalised: false, timeoutHandle: null },
      'error',
      'boom'
    );

    expect(seen).toEqual([['error', 'boom']]);
  });

  test('draining our own already-settled result is a harmless no-op', async () => {
    const seen = [];
    await manager.start(SCRIPT, {}, (status) => seen.push(status));
    const task = await queue.dequeue(manager.QUEUE_INCOMING_);
    await manager.finaliseTask_(
      { task, startedAt: new Date(), finalised: false, timeoutHandle: null },
      'completed',
      { ok: true }
    );

    await manager.processResults_();

    expect(seen).toEqual(['completed']);                                  // not fired twice
    expect(await queue.size(manager.QUEUE_COMPLETE_)).toBe(0);            // and drained
  });
});

describe('working — remote settlement across processes', () => {
  let queue;
  let producer;
  let executor;

  beforeEach(() => {
    // Two managers sharing one broker: `producer` queues the work and holds the
    // callback; `executor` runs it and reports the result.
    queue = new JsonRoundTripQueue();
    producer = makeManager(queue);
    executor = makeManager(queue);
  });

  afterEach(() => { producer.isRunning_ = false; executor.isRunning_ = false; });

  test('the producer’s callback fires for work the executor ran', async () => {
    const seen = [];
    await producer.start(SCRIPT, { job: 1 }, (status, data) => seen.push([status, data]));

    // Executor picks the task up and finishes it — it holds no waiter.
    const task = await queue.dequeue(producer.QUEUE_INCOMING_);
    await executor.finaliseTask_(
      { task, startedAt: new Date(), finalised: false, timeoutHandle: null },
      'completed',
      { answer: 42 }
    );
    expect(seen).toEqual([]); // nothing settled yet — the result is in flight

    await producer.processResults_();

    expect(seen).toEqual([['completed', { answer: 42 }]]);
  });

  test('a sibling’s result is put back rather than swallowed', async () => {
    await producer.start(SCRIPT, {}, () => {});
    const task = await queue.dequeue(producer.QUEUE_INCOMING_);
    await executor.finaliseTask_(
      { task, startedAt: new Date(), finalised: false, timeoutHandle: null },
      'completed',
      { ok: true }
    );

    // A third process drains first; the result is not its own.
    const bystander = makeManager(queue);
    await bystander.processResults_();
    bystander.isRunning_ = false;

    expect(await queue.size(producer.QUEUE_COMPLETE_)).toBe(1);

    // …and the rightful owner still gets it.
    const seen = [];
    producer.pendingCallbacks_.get(task.id).callback = (s, d) => seen.push([s, d]);
    await producer.processResults_();
    expect(seen).toEqual([['completed', { ok: true }]]);
  });

  test('a result nobody claims is eventually dropped, not circulated forever', async () => {
    await queue.enqueue(producer.QUEUE_COMPLETE_, {
      taskId: 'ghost',
      status: 'completed',
      result: {},
      origin: 'a-process-that-no-longer-exists'
    });

    // Each pass recycles it once; the bound is MAX_RESULT_ROUTING_ATTEMPTS.
    for (let i = 0; i < 40; i++) await producer.processResults_();

    expect(await queue.size(producer.QUEUE_COMPLETE_)).toBe(0);
  });
});

describe('working — a result that never arrives fails loudly', () => {
  test('the waiter is failed once its deadline passes', async () => {
    const queue = new JsonRoundTripQueue();
    const manager = makeManager(queue, { callbackTimeout: 1000 });

    const seen = [];
    await manager.start(SCRIPT, {}, (status, data) => seen.push([status, data]));
    await queue.dequeue(manager.QUEUE_INCOMING_); // taken by a process that then dies

    // Nothing has gone wrong yet.
    manager.sweepExpiredWaiters_();
    expect(seen).toEqual([]);

    // Move past the deadline.
    const waiter = [...manager.pendingCallbacks_.values()][0];
    waiter.expiresAt = Date.now() - 1;
    manager.sweepExpiredWaiters_();

    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe('error');
    expect(seen[0][1]).toMatch(/No result received/);
    expect(manager.pendingCallbacks_.size).toBe(0);

    manager.isRunning_ = false;
  });

  test('callbackTimeout outlives workerTimeout by default', () => {
    const manager = makeManager(new JsonRoundTripQueue(), { workerTimeout: 5000 });
    expect(manager.settings.callbackTimeout).toBeGreaterThan(manager.settings.workerTimeout);
    manager.isRunning_ = false;
  });

  test('shutdown fails pending waiters instead of stranding them', async () => {
    const queue = new JsonRoundTripQueue();
    const manager = makeManager(queue);

    const seen = [];
    await manager.start(SCRIPT, {}, (status, data) => seen.push([status, data]));

    await manager.stop();

    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe('error');
    expect(manager.pendingCallbacks_.size).toBe(0);
  });
});
