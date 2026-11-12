/**
 * @fileoverview Reliable jobs on top of a queue provider (feature 06).
 *
 * At-least-once processing with retries, backoff, a dead-letter queue,
 * delayed jobs, priorities, idempotency keys and a consumer API:
 *
 * ```javascript
 * const id = await queue.enqueue('emails', { to }, { attempts: 5, delayMs: 60000, idempotencyKey: `welcome:${userId}` });
 * const consumer = queue.process('emails', async (job) => sendEmail(job.data), { concurrency: 4 });
 * await consumer.stop();             // drains in-flight jobs
 * await queue.retryDeadLetters('emails');
 * ```
 *
 * Job states: waiting, delayed, active, completed, failed (attempt failed and
 * will retry), dead. A handler that throws is retried with backoff until its
 * attempts are used up, then moved to the dead-letter list. A job whose
 * consumer dies is redelivered after `visibilityTimeoutMs`; a running handler
 * keeps extending its own deadline, so slow jobs are not redelivered.
 *
 * Handlers must be idempotent: delivery is at least once, not exactly once.
 *
 * @module queueing/modules/reliableJobs
 */

'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PRIORITIES } = require('./jobStores');
const { ClientError } = require('../../shared/utils/httpErrors');

/** Options a job accepts; anything else is refused. */
const JOB_OPTIONS = new Set(['delayMs', 'attempts', 'backoff', 'idempotencyKey', 'priority', 'dedupeWindowMs', 'jobId']);

/**
 * Delay before the next attempt.
 * @param {!Object} backoff - `{ type: 'fixed'|'exponential', baseMs, maxMs }`
 * @param {number} attempt - Attempts made so far (1 after the first failure)
 * @return {number} Milliseconds
 */
function backoffDelay(backoff, attempt) {
  const base = Math.max(0, Number(backoff.baseMs) || 0);
  const max = Math.max(base, Number(backoff.maxMs) || 60000);
  if (backoff.type === 'fixed') return Math.min(base, max);
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

/**
 * Sleep that does not keep the process alive.
 * @param {number} ms - Milliseconds
 * @param {AbortSignal=} signal - Wakes early when aborted
 * @return {!Promise<void>}
 */
function nap(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    if (timer.unref) timer.unref();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Reliable job engine. One per queue provider instance.
 */
class ReliableJobs {
  /**
   * @param {!Object} store - MemoryJobStore or RedisJobStore
   * @param {Object=} options - Defaults: `{ attempts: 3, backoff, dedupeWindowMs, visibilityTimeoutMs, pollMs }`
   * @param {Object=} hooks - `{ legacyDequeue(queue), eventEmitter, instanceName }`
   */
  constructor(store, options = {}, hooks = {}) {
    this.store_ = store;
    this.defaults_ = {
      attempts: options.attempts ?? 3,
      backoff: { type: 'exponential', baseMs: 1000, maxMs: 60000, ...(options.backoff || {}) },
      dedupeWindowMs: options.dedupeWindowMs ?? 60 * 60 * 1000,
      visibilityTimeoutMs: options.visibilityTimeoutMs ?? 30000,
      pollMs: options.pollMs ?? 500
    };
    this.legacyDequeue_ = hooks.legacyDequeue || null;
    this.events_ = hooks.eventEmitter || null;
    this.instanceName_ = hooks.instanceName || 'default';
    this.consumers_ = new Set();
    this.wake_ = new EventEmitter();
    this.wake_.setMaxListeners(0);
    this.stats_ = new Map();
  }

  /** @private */
  emit_(name, payload) {
    this.events_?.emit(`queue:job:${name}:${this.instanceName_}`, payload);
  }

  /** @private */
  stat_(queue, field) {
    if (!this.stats_.has(queue)) this.stats_.set(queue, { completed: 0, failed: 0, dead: 0, processed: 0 });
    this.stats_.get(queue)[field] += 1;
  }

  /**
   * Adds a job.
   *
   * @param {string} queue - Queue name
   * @param {*} data - Job payload (JSON-serialisable)
   * @param {Object=} options - `{ delayMs, attempts, backoff, idempotencyKey, dedupeWindowMs, priority, jobId }`
   * @return {!Promise<string>} Job id (the existing id for a duplicate idempotency key)
   * @throws {Error} On an unknown option or a bad value
   */
  async add(queue, data, options = {}) {
    for (const key of Object.keys(options)) {
      if (!JOB_OPTIONS.has(key)) throw new ClientError(400, `Unknown job option "${key}"`);
    }
    if (options.priority !== undefined && !PRIORITIES.includes(options.priority)) {
      throw new ClientError(400, `priority must be one of ${PRIORITIES.join(', ')}`);
    }
    const attempts = options.attempts ?? this.defaults_.attempts;
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) throw new ClientError(400, 'attempts must be an integer from 1 to 100');
    const delayMs = Number(options.delayMs) || 0;
    if (delayMs < 0) throw new ClientError(400, 'delayMs cannot be negative');
    const backoff = { ...this.defaults_.backoff, ...(options.backoff || {}) };
    if (!['fixed', 'exponential'].includes(backoff.type)) throw new ClientError(400, 'backoff.type must be fixed or exponential');

    const id = options.jobId || `job_${crypto.randomUUID()}`;
    if (options.idempotencyKey) {
      const existing = await this.store_.reserveKey(queue, String(options.idempotencyKey), id,
        options.dedupeWindowMs ?? this.defaults_.dedupeWindowMs);
      if (existing) {
        this.emit_('duplicate', { queue, id: existing, idempotencyKey: options.idempotencyKey });
        return existing;
      }
    }
    const now = Date.now();
    const job = {
      id,
      queue,
      data,
      state: delayMs > 0 ? 'delayed' : 'waiting',
      attempts: 0,
      maxAttempts: attempts,
      backoff,
      priority: options.priority || 'normal',
      idempotencyKey: options.idempotencyKey || null,
      createdAt: now,
      availableAt: now + delayMs,
      lastError: null,
      finishedAt: null
    };
    await this.store_.save(job);
    await this.store_.schedule(queue, id, job.availableAt, job.priority);
    this.emit_('added', { queue, id, delayMs });
    this.wake_.emit(queue);
    return id;
  }

  /**
   * A job's record.
   * @param {string} id - Job id
   * @return {!Promise<?Object>}
   */
  async getJob(id) {
    const job = await this.store_.get(id);
    if (job && (job.state === 'waiting' || job.state === 'delayed')) {
      job.state = job.availableAt > Date.now() ? 'delayed' : 'waiting';
    }
    return job;
  }

  /**
   * Starts a consumer.
   *
   * @param {string} queue - Queue name
   * @param {function(!Object): (Promise<*>|*)} handler - Receives the job; throw to retry
   * @param {Object=} options - `{ concurrency: 1, visibilityTimeoutMs, pollMs }`
   * @return {{stop: function(Object=): !Promise<void>, running: function(): number}}
   */
  process(queue, handler, options = {}) {
    if (typeof handler !== 'function') throw new Error('process() needs a handler function');
    const concurrency = Math.max(1, Math.min(100, Number(options.concurrency) || 1));
    const visibilityMs = Number(options.visibilityTimeoutMs) || this.defaults_.visibilityTimeoutMs;
    const pollMs = Number(options.pollMs) || this.defaults_.pollMs;
    const controller = new AbortController();
    const inFlight = new Map();
    let lastSweep = 0;

    const onWake = () => controller.signal.dispatchEvent(new Event('wake'));
    this.wake_.on(queue, onWake);

    const sweep = async () => {
      if (Date.now() - lastSweep < Math.min(1000, visibilityMs / 2)) return;
      lastSweep = Date.now();
      for (const id of await this.store_.expired(queue, Date.now())) {
        const job = await this.store_.get(id);
        if (!job) continue;
        job.state = 'waiting';
        job.lastError = job.lastError || 'Visibility timeout: consumer stopped responding';
        await this.store_.save(job);
        await this.store_.schedule(queue, id, Date.now(), job.priority);
        this.emit_('redelivered', { queue, id });
      }
    };

    const runJob = async (id) => {
      // Keep the visibility deadline moving from the moment the job is ours,
      // before any round trip, so a slow store cannot let it expire.
      const keepAlive = setInterval(() => {
        this.store_.touch(queue, id, Date.now() + visibilityMs).catch(() => {});
      }, Math.max(20, Math.floor(visibilityMs / 3)));
      if (keepAlive.unref) keepAlive.unref();
      const job = await this.store_.get(id);
      if (!job) {
        clearInterval(keepAlive);
        await this.store_.ack(queue, id);
        return;
      }
      job.state = 'active';
      job.attempts += 1;
      job.startedAt = Date.now();
      await this.store_.save(job);
      this.emit_('active', { queue, id, attempt: job.attempts });
      try {
        const result = await handler({ ...job, data: job.data });
        clearInterval(keepAlive);
        job.state = 'completed';
        job.finishedAt = Date.now();
        job.result = result === undefined ? null : result;
        await this.store_.ack(queue, id);
        await this.store_.save(job);
        this.stat_(queue, 'completed');
        this.emit_('completed', { queue, id, attempts: job.attempts });
      } catch (error) {
        clearInterval(keepAlive);
        job.lastError = String((error && error.message) || error).slice(0, 2000);
        if (job.attempts >= job.maxAttempts) {
          job.state = 'dead';
          job.finishedAt = Date.now();
          await this.store_.save(job);
          await this.store_.bury(queue, id);
          this.stat_(queue, 'dead');
          this.emit_('dead', { queue, id, attempts: job.attempts, error: job.lastError });
        } else {
          job.state = 'failed';
          job.availableAt = Date.now() + backoffDelay(job.backoff, job.attempts);
          await this.store_.save(job);
          await this.store_.schedule(queue, id, job.availableAt, job.priority);
          this.stat_(queue, 'failed');
          this.emit_('failed', { queue, id, attempts: job.attempts, retryAt: job.availableAt, error: job.lastError });
        }
      } finally {
        this.stat_(queue, 'processed');
      }
    };

    const loop = (async () => {
      while (!controller.signal.aborted) {
        try {
          await sweep();
          let started = false;
          while (inFlight.size < concurrency && !controller.signal.aborted) {
            const id = await this.store_.claim(queue, Date.now(), Date.now() + visibilityMs);
            if (!id) {
              // Items added with the plain enqueue(queue, item) become jobs on pickup.
              const legacy = this.legacyDequeue_ ? await this.legacyDequeue_(queue) : undefined;
              if (legacy === undefined || legacy === null) break;
              await this.add(queue, legacy);
              continue;
            }
            started = true;
            const task = runJob(id).catch((error) => this.emit_('error', { queue, id, error: error.message }))
              .finally(() => {
                inFlight.delete(id);
                controller.signal.dispatchEvent(new Event('wake'));
              });
            inFlight.set(id, task);
          }
          if (!started || inFlight.size >= concurrency) {
            await napUntilWake(pollMs, controller.signal);
          }
        } catch (error) {
          this.emit_('error', { queue, error: error.message });
          await napUntilWake(pollMs, controller.signal);
        }
      }
    })();

    const consumer = {
      queue,
      running: () => inFlight.size,
      /**
       * Stops taking jobs and waits for running ones (up to `timeoutMs`,
       * default 30 s). Jobs still running after that return to the queue.
       * @param {Object=} opts - `{ timeoutMs }`
       */
      stop: async ({ timeoutMs = 30000 } = {}) => {
        if (!controller.signal.aborted) controller.abort();
        this.wake_.off(queue, onWake);
        await loop;
        const pending = Array.from(inFlight.entries());
        const drained = await Promise.race([
          Promise.allSettled(pending.map(([, task]) => task)).then(() => true),
          nap(timeoutMs).then(() => false)
        ]);
        if (!drained) {
          for (const [id] of inFlight) {
            const job = await this.store_.get(id);
            if (job) {
              job.state = 'waiting';
              job.attempts = Math.max(0, job.attempts - 1);
              await this.store_.save(job);
              await this.store_.schedule(queue, id, Date.now(), job.priority);
            }
          }
        }
        this.consumers_.delete(consumer);
      }
    };
    this.consumers_.add(consumer);
    return consumer;
  }

  /**
   * Moves dead jobs back to the queue with fresh attempts.
   * @param {string} queue - Queue name
   * @param {Object=} options - `{ ids }` to retry only some
   * @return {!Promise<number>} How many were requeued
   */
  async retryDeadLetters(queue, options = {}) {
    const ids = options.ids || await this.store_.listDead(queue, 10000);
    let count = 0;
    for (const id of ids) {
      if (!(await this.store_.unbury(queue, id))) continue;
      const job = await this.store_.get(id);
      if (!job) continue;
      job.state = 'waiting';
      job.attempts = 0;
      job.availableAt = Date.now();
      job.finishedAt = null;
      await this.store_.save(job);
      await this.store_.schedule(queue, id, job.availableAt, job.priority);
      count += 1;
    }
    if (count) this.wake_.emit(queue);
    this.emit_('dead-retried', { queue, count });
    return count;
  }

  /**
   * Dead jobs, oldest first.
   * @param {string} queue - Queue name
   * @param {number=} limit - Max entries (100)
   * @return {!Promise<!Array<Object>>}
   */
  async listDeadLetters(queue, limit = 100) {
    const ids = await this.store_.listDead(queue, limit);
    const jobs = await Promise.all(ids.map((id) => this.store_.get(id)));
    return jobs.filter(Boolean);
  }

  /**
   * Deletes a job wherever it is.
   * @param {string} queue - Queue name
   * @param {string} id - Job id
   * @return {!Promise<boolean>}
   */
  async removeJob(queue, id) {
    return this.store_.remove(queue, id);
  }

  /**
   * Counts by state, plus this process's throughput counters.
   * @param {string} queue - Queue name
   * @return {!Promise<Object>}
   */
  async counts(queue) {
    const counts = await this.store_.counts(queue, Date.now());
    return { ...counts, processed: { ...(this.stats_.get(queue) || { completed: 0, failed: 0, dead: 0, processed: 0 }) } };
  }

  /** @return {!Promise<!Array<string>>} Queues that have had jobs. */
  async queues() {
    return this.store_.queues();
  }

  /**
   * Stops every consumer (graceful shutdown).
   * @param {Object=} options - `{ timeoutMs }`
   */
  async stopAll(options) {
    await Promise.all(Array.from(this.consumers_).map((c) => c.stop(options)));
  }
}

/**
 * Waits for `ms`, a wake event, or abort.
 * @param {number} ms - Milliseconds
 * @param {!AbortSignal} signal - Consumer signal (also carries 'wake')
 * @return {!Promise<void>}
 */
function napUntilWake(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    if (timer.unref) timer.unref();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('wake', done);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('wake', done, { once: true });
    signal.addEventListener('abort', done, { once: true });
  });
}

module.exports = { ReliableJobs, backoffDelay, JOB_OPTIONS };
