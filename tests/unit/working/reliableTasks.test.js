/**
 * @fileoverview The working service's tasks as reliable jobs (feature 06).
 *
 * On a queue that supports reliable jobs (memory and Redis), each task is
 * enqueued with `attempts: 1` and held by a consumer until its worker is
 * finalised. A task that finishes is acknowledged. A worker that exits without
 * a result is finalised as an error, so it is not redelivered forever.
 */
'use strict';

const path = require('node:path');
const EventEmitter = require('events');

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn().mockResolvedValue(undefined),
  })),
  parentPort: { on: jest.fn(), postMessage: jest.fn() },
}));

const { Worker } = require('worker_threads');
const WorkerManager = require('../../../src/working/providers/working');
const getQueueService = require('../../../src/queueing');

const INCOMING = 'nooblyjs-core-working-incoming';
const SCRIPT = path.resolve(__dirname, './exampleTask.js');

/** Waits until `check()` is true, polling every 20 ms. */
async function waitFor(check, timeoutMs = 3000) {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The handler a worker registered for an event, from the most recent worker. */
function workerHandler(event) {
  const worker = Worker.mock.results[Worker.mock.results.length - 1].value;
  const call = worker.on.mock.calls.find(([name]) => name === event);
  return call && call[1];
}

describe('working tasks as reliable jobs (feature 06)', () => {
  let emitter;
  let queue;
  let manager;

  beforeEach(() => {
    Worker.mockClear();
    emitter = new EventEmitter();
    queue = getQueueService('memory', {}, emitter);
    manager = new WorkerManager({
      dependencies: { queueing: queue },
      enableLogging: false,
      allowAbsolutePaths: true,
      maxThreads: 2
    }, emitter);
  });

  afterEach(async () => {
    await manager.stop();
    queue.stopConsumers?.();
  });

  it('is detected from the queue, which must support reliable jobs', () => {
    expect(manager.usesReliableTasks_()).toBe(true);
  });

  it('enqueues each task as a reliable job with one attempt', async () => {
    const spy = jest.spyOn(queue, 'enqueue');
    await manager.start(SCRIPT, {}, () => {});
    expect(spy).toHaveBeenCalledWith(INCOMING, expect.objectContaining({ scriptPath: SCRIPT }), { attempts: 1 });
  });

  it('runs a queued task through the consumer and acknowledges it when the worker completes', async () => {
    const callback = jest.fn();
    await manager.start(SCRIPT, { n: 1 }, callback);

    await waitFor(() => Worker.mock.calls.length === 1);
    expect(await queue.jobCounts(INCOMING)).toEqual(expect.objectContaining({ active: 1 }));

    // The worker reports its result, which finalises the task.
    await workerHandler('message')({ type: 'status', status: 'completed', data: 'done' });

    await waitFor(async () => (await queue.jobCounts(INCOMING)).completed === 1);
    const counts = await queue.jobCounts(INCOMING);
    expect(counts.active).toBe(0);
    expect(counts.dead).toBe(0);
    expect(callback).toHaveBeenCalledWith('completed', 'done');
  });

  it('finalises a worker that exits without a result as an error, so the job is acknowledged', async () => {
    const callback = jest.fn();
    await manager.start(SCRIPT, {}, callback);
    await waitFor(() => Worker.mock.calls.length === 1);

    await workerHandler('exit')(0);

    await waitFor(async () => (await queue.jobCounts(INCOMING)).completed === 1);
    expect((await queue.jobCounts(INCOMING)).active).toBe(0);
    expect(callback).toHaveBeenCalledWith('error', 'Worker exited without reporting a result');
  });

  it('does not start more workers than maxThreads at once', async () => {
    for (let i = 0; i < 4; i += 1) {
      await manager.start(SCRIPT, { i }, () => {});
    }
    await waitFor(() => Worker.mock.calls.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(Worker.mock.calls.length).toBe(2);
    expect((await queue.jobCounts(INCOMING)).active).toBe(2);
  });
});
