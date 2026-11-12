/**
 * @fileoverview Adds the reliable-jobs API (feature 06) to a queue provider.
 *
 * - memory: in-process job store (not shared, not durable).
 * - redis: Redis job store on the provider's own client (shared, durable).
 * - other providers: the job methods throw a clear "not supported" error,
 *   unless `jobs: { store: 'memory' }` opts in to in-process jobs alongside
 *   the broker (retries and dead letters work, but a crash loses jobs).
 *
 * `enqueue(queue, item)` and `dequeue(queue)` are unchanged; `enqueue` with a
 * third argument creates a job and returns its id. A consumer started with
 * `process()` also picks up items added with the plain `enqueue`.
 *
 * @module queueing/modules/attachJobs
 */

'use strict';

const { MemoryJobStore, RedisJobStore } = require('./jobStores');
const { ReliableJobs } = require('./reliableJobs');

const JOB_METHODS = ['process', 'getJob', 'retryDeadLetters', 'listDeadLetters', 'removeJob', 'jobCounts', 'jobQueues'];

/**
 * Wraps every store method so it first waits for `ready()`.
 * @param {!Object} store - Job store
 * @param {function(): !Promise<void>} ready - Connection check
 * @return {!Object}
 */
function withReady(store, ready) {
  const proto = Object.getPrototypeOf(store);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || name.endsWith('_') || typeof store[name] !== 'function') continue;
    const original = store[name].bind(store);
    store[name] = async (...args) => {
      await ready();
      return original(...args);
    };
  }
  return store;
}

/**
 * Attaches reliable jobs to a queue provider instance.
 *
 * @param {!Object} queue - Provider instance
 * @param {string} type - Provider type
 * @param {Object} options - Provider options (`jobs` holds job defaults)
 * @param {EventEmitter=} eventEmitter - Shared emitter
 * @return {!Object} The same queue
 */
function attachJobs(queue, type, options = {}, eventEmitter) {
  const jobOptions = options.jobs || {};
  let store = null;
  if (type === 'memory' || type === undefined || jobOptions.store === 'memory') {
    store = new MemoryJobStore(jobOptions);
  } else if (type === 'redis' && queue.client_) {
    store = withReady(new RedisJobStore(queue.client_, jobOptions), () =>
      (typeof queue.ensureConnection_ === 'function' ? queue.ensureConnection_() : Promise.resolve()));
  }

  const plainEnqueue = queue.enqueue.bind(queue);
  const plainDequeue = queue.dequeue.bind(queue);
  const instanceName = options.instanceName || 'default';

  if (!store) {
    const unsupported = () => {
      throw new Error(`Reliable jobs are not supported by the "${type}" queue provider yet. `
        + 'Use the memory or redis provider, or set jobs: { store: "memory" } for in-process (non-durable) jobs.');
    };
    for (const name of JOB_METHODS) queue[name] = unsupported;
    // The api provider forwards job options to the remote queue service.
    queue.enqueue = type === 'api'
      ? plainEnqueue
      : async (name, item, opts) => (opts === undefined ? plainEnqueue(name, item) : unsupported());
    queue.stopConsumers = async () => {};
    queue.supportsJobs = false;
    return queue;
  }

  const jobs = new ReliableJobs(store, jobOptions, {
    legacyDequeue: plainDequeue,
    eventEmitter,
    instanceName
  });

  queue.jobs = jobs;
  queue.supportsJobs = true;
  queue.jobsDurable = Boolean(store.durable);
  queue.enqueue = async (name, item, opts) => {
    if (opts === undefined || opts === null) return plainEnqueue(name, item);
    if (!name || typeof name !== 'string' || name.trim() === '') throw new Error('Invalid queueName: must be a non-empty string');
    if (item === undefined) throw new Error('Invalid item: cannot be undefined');
    if (typeof opts !== 'object' || Array.isArray(opts)) throw new Error('Job options must be an object');
    return jobs.add(name, item, opts);
  };
  queue.process = (name, handler, opts) => jobs.process(name, handler, opts);
  queue.getJob = (id) => jobs.getJob(id);
  queue.retryDeadLetters = (name, opts) => jobs.retryDeadLetters(name, opts);
  queue.listDeadLetters = (name, limit) => jobs.listDeadLetters(name, limit);
  queue.removeJob = (name, id) => jobs.removeJob(name, id);
  queue.jobCounts = (name) => jobs.counts(name);
  queue.jobQueues = () => jobs.queues();
  queue.stopConsumers = (opts) => jobs.stopAll(opts);
  return queue;
}

module.exports = { attachJobs, JOB_METHODS };
