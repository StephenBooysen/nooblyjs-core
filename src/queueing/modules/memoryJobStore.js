/**
 * @fileoverview In-process job store for reliable jobs (feature 06). Every
 * operation runs synchronously between awaits, so each step is atomic.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const { SCORE_BAND, readyScore } = require('./reliableJobs');

/** Copies a document so callers cannot change stored state. */
const copy = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : null);

class MemoryJobStore {
  /**
   * @param {Object=} options
   * @param {number=} options.completedRetention Completed jobs kept per queue (default 1000)
   */
  constructor(options = {}) {
    this.docs_ = new Map();
    this.queues_ = new Map();
    this.dedupe_ = new Map();
    this.seq_ = 0;
    this.completedRetention_ = options.completedRetention ?? 1000;
  }

  /** @private */
  queue_(name) {
    if (!this.queues_.has(name)) {
      this.queues_.set(name, { ready: new Map(), delayed: new Map(), active: new Map(), dead: new Map(), completed: new Map() });
    }
    return this.queues_.get(name);
  }

  /** @private Moves due delayed jobs to ready and redelivers jobs whose lease ended. */
  settle_(q, now) {
    for (const [id, runAt] of q.delayed) {
      if (runAt <= now) {
        q.delayed.delete(id);
        const doc = this.docs_.get(id);
        doc.state = 'waiting';
        q.ready.set(id, doc.score);
      }
    }
    for (const [id, leaseUntil] of q.active) {
      if (leaseUntil > now) continue;
      q.active.delete(id);
      const doc = this.docs_.get(id);
      doc.leaseUntil = 0;
      if (doc.attempts >= doc.maxAttempts) {
        doc.state = 'dead';
        doc.deadAt = now;
        doc.lastError = 'visibility timeout expired';
        q.dead.set(id, now);
      } else {
        doc.state = 'waiting';
        doc.lastError = 'visibility timeout expired';
        q.ready.set(id, doc.score);
      }
    }
  }

  /**
   * @param {Object} doc Job document from the engine
   * @param {{delayed: boolean, rank: number, runAt: number}} placement Where the job goes
   * @return {Promise<void>}
   */
  async insert(doc, placement) {
    const q = this.queue_(doc.queue);
    this.seq_ += 1;
    const stored = copy(doc);
    stored.score = placement.rank * SCORE_BAND + this.seq_;
    this.docs_.set(doc.id, stored);
    if (placement.delayed) {
      q.delayed.set(doc.id, placement.runAt);
    } else {
      q.ready.set(doc.id, stored.score);
    }
  }

  /**
   * Claims an idempotency key for a window. Returns the id already holding it, or null after claiming it.
   * @param {string} queueName Queue name
   * @param {string} key Idempotency key
   * @param {number} ttlMs Window length
   * @param {?string} id Id to record when the key is free
   * @return {Promise<?string>} Existing id, or null when this call claimed the key
   */
  async claimDedupe(queueName, key, ttlMs, id) {
    const k = `${queueName}\u0000${key}`;
    const now = Date.now();
    const held = this.dedupe_.get(k);
    if (held && held.expiresAt > now) return held.id;
    this.dedupe_.set(k, { id, expiresAt: now + ttlMs });
    return null;
  }

  /**
   * Takes the highest-priority ready job, marking it active with a lease.
   * @param {string} queueName Queue name
   * @param {number} now Current time in ms
   * @param {number} leaseMs Visibility timeout
   * @return {Promise<?Object>} The claimed job, or null
   */
  async claim(queueName, now, leaseMs) {
    const q = this.queue_(queueName);
    this.settle_(q, now);
    let best = null;
    for (const [id, score] of q.ready) {
      if (best === null || score < best.score) best = { id, score };
    }
    if (best === null) return null;
    q.ready.delete(best.id);
    const doc = this.docs_.get(best.id);
    doc.attempts += 1;
    doc.state = 'active';
    doc.leaseUntil = now + leaseMs;
    q.active.set(best.id, doc.leaseUntil);
    return copy(doc);
  }

  /**
   * Marks an active job completed and trims old completed jobs.
   * @return {Promise<void>}
   */
  async ack(queueName, id, now) {
    const q = this.queue_(queueName);
    q.active.delete(id);
    const doc = this.docs_.get(id);
    if (!doc) return;
    doc.state = 'completed';
    doc.completedAt = now;
    doc.leaseUntil = 0;
    q.completed.set(id, now);
    if (q.completed.size > this.completedRetention_) {
      const ordered = [...q.completed.entries()].sort((a, b) => a[1] - b[1]);
      for (const [old] of ordered.slice(0, ordered.length - this.completedRetention_)) {
        q.completed.delete(old);
        this.docs_.delete(old);
      }
    }
  }

  /**
   * Records a failed attempt: schedules a retry when retryAt is set, otherwise dead-letters the job.
   * @return {Promise<void>}
   */
  async fail(queueName, id, error, retryAt, now) {
    const q = this.queue_(queueName);
    q.active.delete(id);
    const doc = this.docs_.get(id);
    if (!doc) return;
    doc.lastError = error;
    doc.leaseUntil = 0;
    if (retryAt > 0) {
      doc.state = 'failed';
      q.delayed.set(id, retryAt);
    } else {
      doc.state = 'dead';
      doc.deadAt = now;
      q.dead.set(id, now);
    }
  }

  /** @return {Promise<?Object>} The stored job, or null */
  async get(id) {
    return copy(this.docs_.get(id) || null);
  }

  /**
   * Requeues every dead job with attempts reset.
   * @return {Promise<number>} Count requeued
   */
  async retryDead(queueName, now) {
    const q = this.queue_(queueName);
    let n = 0;
    for (const id of [...q.dead.keys()]) {
      q.dead.delete(id);
      const doc = this.docs_.get(id);
      doc.attempts = 0;
      doc.state = 'waiting';
      doc.lastError = '';
      doc.deadAt = 0;
      q.ready.set(id, doc.score);
      n += 1;
    }
    this.settle_(q, now);
    return n;
  }

  /** @return {Promise<{waiting: number, delayed: number, active: number, completed: number, dead: number}>} */
  async counts(queueName) {
    const q = this.queue_(queueName);
    return {
      waiting: q.ready.size,
      delayed: q.delayed.size,
      active: q.active.size,
      completed: q.completed.size,
      dead: q.dead.size
    };
  }
}

module.exports = { MemoryJobStore, readyScore };
