/**
 * @fileoverview Reliable jobs on top of a queue store (feature 06).
 *
 * The engine owns the semantics: options, retries with backoff, dead-lettering,
 * idempotency and the consumer loop. A store owns the persistence and makes the
 * claim, acknowledge and fail steps atomic. The memory and Redis providers each
 * supply a store; other providers reject reliable options with a clear error.
 *
 * Delivery is at-least-once. A job whose handler is still running when its
 * visibility timeout ends is delivered again, so handlers should be idempotent.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const crypto = require('node:crypto');
const { ClientError } = require('../../shared/utils/httpErrors');

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
/** Score spacing between priority bands; sequence numbers stay below it. */
const SCORE_BAND = 1e10;

const DEFAULTS = Object.freeze({
  attempts: 3,
  backoff: Object.freeze({ type: 'exponential', baseMs: 1000, maxMs: 60000 }),
  priority: 'normal',
  delayMs: 0,
  dedupeWindowMs: 24 * 60 * 60 * 1000,
  visibilityTimeoutMs: 30000,
  pollIntervalMs: 250,
  concurrency: 1,
  completedRetention: 1000
});

const ENQUEUE_KEYS = new Set(['delayMs', 'attempts', 'backoff', 'idempotencyKey', 'priority', 'dedupeWindowMs']);

/**
 * Checks enqueue options and fills in defaults.
 *
 * @param {Object} options Options from the caller
 * @return {{delayMs: number, attempts: number, backoff: Object, idempotencyKey: ?string, priority: string, dedupeWindowMs: number}} Normalised options
 * @throws {ClientError} 400 when an option is unknown or out of range
 */
function normalizeEnqueueOptions(options = {}) {
  for (const key of Object.keys(options)) {
    if (!ENQUEUE_KEYS.has(key)) {
      throw new ClientError(400, `Unknown job option "${key}". Valid options: ${[...ENQUEUE_KEYS].join(', ')}`);
    }
  }
  const delayMs = options.delayMs ?? DEFAULTS.delayMs;
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new ClientError(400, 'delayMs must be a number of milliseconds, zero or more');
  }
  const attempts = options.attempts ?? DEFAULTS.attempts;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) {
    throw new ClientError(400, 'attempts must be a whole number from 1 to 100');
  }
  const backoff = { ...DEFAULTS.backoff, ...(options.backoff || {}) };
  if (!['fixed', 'exponential'].includes(backoff.type)) {
    throw new ClientError(400, 'backoff.type must be "fixed" or "exponential"');
  }
  if (!Number.isFinite(backoff.baseMs) || backoff.baseMs < 0 || !Number.isFinite(backoff.maxMs) || backoff.maxMs < backoff.baseMs) {
    throw new ClientError(400, 'backoff needs baseMs >= 0 and maxMs >= baseMs');
  }
  const priority = options.priority ?? DEFAULTS.priority;
  if (!(priority in PRIORITY_RANK)) {
    throw new ClientError(400, 'priority must be "high", "normal" or "low"');
  }
  const idempotencyKey = options.idempotencyKey ?? null;
  if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > 200)) {
    throw new ClientError(400, 'idempotencyKey must be a non-empty string of at most 200 characters');
  }
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULTS.dedupeWindowMs;
  if (!Number.isFinite(dedupeWindowMs) || dedupeWindowMs <= 0) {
    throw new ClientError(400, 'dedupeWindowMs must be a positive number of milliseconds');
  }
  return { delayMs, attempts, backoff, priority, idempotencyKey, dedupeWindowMs };
}

/**
 * Milliseconds to wait before the next attempt, after `attemptsSoFar` attempts.
 *
 * @param {{type: string, baseMs: number, maxMs: number}} backoff Backoff policy
 * @param {number} attemptsSoFar Attempts already made (1 or more)
 * @return {number} Delay in milliseconds
 */
function computeBackoffMs(backoff, attemptsSoFar) {
  if (backoff.type === 'fixed') return backoff.baseMs;
  return Math.min(backoff.maxMs, backoff.baseMs * (2 ** Math.max(0, attemptsSoFar - 1)));
}

/**
 * Sort key for ready jobs: priority band first, then arrival order.
 * @param {string} priority Priority name
 * @param {number} seq Arrival sequence number from the store
 * @return {number} Score (lower runs first)
 */
function readyScore(priority, seq) {
  return PRIORITY_RANK[priority] * SCORE_BAND + seq;
}

/** Converts a stored job document into the shape callers see. */
function publicJob(doc) {
  if (!doc) return null;
  const { dataJson, backoffJson, score, ...rest } = doc;
  return {
    ...rest,
    data: dataJson === undefined ? undefined : JSON.parse(dataJson),
    backoff: JSON.parse(backoffJson)
  };
}

/**
 * Engine that runs the job lifecycle over a store.
 */
class ReliableJobs {
  /**
   * @param {Object} store Persistence with: insert, claimDedupe(queue, key, ttlMs, id) -> existingId|null (atomic SET NX), claim, ack, fail, get, retryDead, counts
   * @param {Object=} options Engine options
   * @param {function(): number=} options.clock Millisecond clock (for tests)
   * @param {function(): string=} options.idFn Job id generator
   * @param {Object=} options.logger Optional logger with error()
   */
  constructor(store, options = {}) {
    this.store_ = store;
    this.clock_ = options.clock || Date.now;
    this.idFn_ = options.idFn || (() => `job_${crypto.randomUUID()}`);
    this.logger_ = options.logger || null;
    this.consumers_ = new Set();
  }

  /**
   * Adds a job to a queue.
   *
   * @param {string} queueName Queue name
   * @param {*} data JSON-serialisable job payload
   * @param {Object=} options See normalizeEnqueueOptions
   * @return {Promise<{id: string, deduplicated: boolean}>} The job id
   */
  async enqueue(queueName, data, options = {}) {
    const opts = normalizeEnqueueOptions(options);
    const now = this.clock_();
    const id = this.idFn_();
    if (opts.idempotencyKey) {
      // One atomic claim: the first caller records its id, later callers get it back.
      const existing = await this.store_.claimDedupe(queueName, opts.idempotencyKey, opts.dedupeWindowMs, id);
      if (existing) return { id: existing, deduplicated: true };
    }
    const delayed = opts.delayMs > 0;
    const doc = {
      id,
      queue: queueName,
      state: delayed ? 'delayed' : 'waiting',
      priority: opts.priority,
      attempts: 0,
      maxAttempts: opts.attempts,
      backoffJson: JSON.stringify(opts.backoff),
      dataJson: JSON.stringify(data === undefined ? null : data),
      idempotencyKey: opts.idempotencyKey,
      runAt: delayed ? now + opts.delayMs : now,
      leaseUntil: 0,
      lastError: '',
      createdAt: now,
      completedAt: 0,
      deadAt: 0
    };
    await this.store_.insert(doc, { delayed, rank: PRIORITY_RANK[opts.priority], runAt: doc.runAt });
    return { id, deduplicated: false };
  }

  /**
   * Returns a job's current state.
   * @param {string} id Job id
   * @param {string=} queueName Queue the job belongs to (needed by some stores)
   * @return {Promise<Object|null>} The job, or null when unknown or trimmed
   */
  async getJob(id, queueName) {
    return publicJob(await this.store_.get(id, queueName));
  }

  /**
   * Moves every dead job back to the waiting state with its attempts reset.
   * @param {string} queueName Queue name
   * @return {Promise<number>} How many jobs were requeued
   */
  async retryDeadLetters(queueName) {
    return this.store_.retryDead(queueName, this.clock_());
  }

  /**
   * Counts jobs by state for one queue.
   * @param {string} queueName Queue name
   * @return {Promise<{waiting: number, delayed: number, active: number, completed: number, dead: number}>} Counts
   */
  async counts(queueName) {
    return this.store_.counts(queueName);
  }

  /**
   * Starts a consumer that runs `handler` for each job in a queue.
   *
   * @param {string} queueName Queue name
   * @param {function(Object): Promise<*>} handler Throw to fail the job
   * @param {Object=} options Consumer options
   * @param {number=} options.concurrency Jobs in flight at once (default 1)
   * @param {number=} options.visibilityTimeoutMs Lease length (default 30 s)
   * @param {number=} options.pollIntervalMs Wait when the queue is empty (default 250 ms)
   * @return {{stop: function(): Promise<void>, inFlight: function(): number}} Consumer handle
   */
  process(queueName, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new ClientError(400, 'process() needs a handler function');
    }
    const concurrency = options.concurrency ?? DEFAULTS.concurrency;
    const visibility = options.visibilityTimeoutMs ?? DEFAULTS.visibilityTimeoutMs;
    const poll = options.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
      throw new ClientError(400, 'concurrency must be a whole number from 1 to 100');
    }
    if (!Number.isFinite(visibility) || visibility <= 0) {
      throw new ClientError(400, 'visibilityTimeoutMs must be a positive number of milliseconds');
    }

    const inFlight = new Set();
    let running = true;
    let timer = null;
    let wake = null;

    const sleep = (ms) => new Promise((resolve) => {
      wake = resolve;
      timer = setTimeout(() => { timer = null; wake = null; resolve(); }, ms);
    });

    const runOne = async (job) => {
      try {
        await handler(job);
        await this.store_.ack(queueName, job.id, this.clock_());
      } catch (err) {
        const retry = job.attempts < job.maxAttempts;
        const retryAt = retry ? this.clock_() + computeBackoffMs(job.backoff, job.attempts) : 0;
        try {
          await this.store_.fail(queueName, job.id, String(err?.message || err), retryAt, this.clock_());
        } catch (storeErr) {
          this.logger_?.error?.(`[ReliableJobs] could not record failure of ${job.id}: ${storeErr.message}`);
        }
      }
    };

    const loop = async () => {
      while (running) {
        let claimed = false;
        while (running && inFlight.size < concurrency) {
          const doc = await this.store_.claim(queueName, this.clock_(), visibility);
          if (!doc) break;
          claimed = true;
          const job = publicJob(doc);
          const task = runOne(job).finally(() => inFlight.delete(task));
          inFlight.add(task);
        }
        if (!running) break;
        if (!claimed || inFlight.size >= concurrency) {
          await sleep(poll);
        }
      }
    };

    const loopDone = loop().catch((err) => {
      this.logger_?.error?.(`[ReliableJobs] consumer for "${queueName}" stopped: ${err.message}`);
    });

    const consumer = {
      inFlight: () => inFlight.size,
      stop: async () => {
        running = false;
        if (timer) clearTimeout(timer);
        wake?.();
        await loopDone;
        await Promise.allSettled([...inFlight]);
        this.consumers_.delete(consumer);
      }
    };
    this.consumers_.add(consumer);
    return consumer;
  }

  /**
   * Stops every consumer this engine started and waits for in-flight jobs.
   * Called on graceful shutdown.
   * @return {Promise<void>}
   */
  async stopConsumers() {
    await Promise.allSettled([...this.consumers_].map((c) => c.stop()));
  }
}

module.exports = {
  ReliableJobs,
  normalizeEnqueueOptions,
  computeBackoffMs,
  readyScore,
  publicJob,
  PRIORITY_RANK,
  SCORE_BAND,
  DEFAULTS
};

/**
 * Adds reliable-job methods to a queue provider that has a job store.
 * `enqueue` keeps its behaviour when no options are passed.
 *
 * @param {Object} provider Queue provider instance
 * @param {ReliableJobs} engine Engine over the provider's store
 * @param {{validateQueueName?: function(string, string): void}=} options Name check
 * @return {void}
 */
function attachReliableJobs(provider, engine, options = {}) {
  const legacyEnqueue = provider.enqueue.bind(provider);
  provider.enqueue = async (queueName, item, jobOptions) => {
    if (jobOptions === undefined) return legacyEnqueue(queueName, item);
    options.validateQueueName?.(queueName, 'enqueue');
    const { id } = await engine.enqueue(queueName, item, jobOptions);
    return id;
  };
  provider.process = (queueName, handler, consumerOptions) => engine.process(queueName, handler, consumerOptions);
  provider.getJob = (id, queueName) => engine.getJob(id, queueName);
  provider.retryDeadLetters = (queueName) => engine.retryDeadLetters(queueName);
  provider.jobCounts = (queueName) => engine.counts(queueName);
  provider.stopConsumers = () => engine.stopConsumers();
  provider.supportsReliableJobs = true;
}

/**
 * Makes a provider without a job store refuse reliable options, rather than
 * ignore them.
 *
 * @param {Object} provider Queue provider instance
 * @param {string} providerType Provider name, for the error message
 * @return {void}
 */
function attachUnsupportedJobs(provider, providerType) {
  const legacyEnqueue = provider.enqueue.bind(provider);
  const refuse = () => {
    throw new ClientError(400, `Reliable jobs are not supported by the ${providerType} queueing provider; use the memory or redis provider`);
  };
  provider.enqueue = async (queueName, item, jobOptions) => {
    if (jobOptions !== undefined) refuse();
    return legacyEnqueue(queueName, item);
  };
  provider.process = refuse;
  provider.getJob = refuse;
  provider.retryDeadLetters = refuse;
  provider.jobCounts = refuse;
  provider.stopConsumers = async () => {};
  provider.supportsReliableJobs = false;
}

module.exports.attachReliableJobs = attachReliableJobs;
module.exports.attachUnsupportedJobs = attachUnsupportedJobs;
