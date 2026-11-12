/**
 * @fileoverview Job stores for reliable jobs (feature 06).
 *
 * A store keeps job records and four structures per queue:
 * - ready: three sorted sets (high, normal, low priority) scored by the time
 *   the job becomes available, so delayed jobs simply sort into the future;
 * - active: a sorted set scored by the visibility deadline, so a job whose
 *   consumer died is found and put back (redelivery);
 * - dead: the dead-letter list;
 * - dedupe keys for idempotency.
 *
 * `MemoryJobStore` uses maps; `RedisJobStore` uses Redis sorted sets with Lua
 * scripts for the atomic moves (claim, redelivery), so several processes can
 * share one queue.
 *
 * @module queueing/modules/jobStores
 */

'use strict';

/** Priority names in claim order. */
const PRIORITIES = ['high', 'normal', 'low'];

/**
 * Index of a priority name (unknown names count as normal).
 * @param {string=} priority - high, normal or low
 * @return {number}
 */
function priorityRank(priority) {
  const rank = PRIORITIES.indexOf(priority || 'normal');
  return rank === -1 ? 1 : rank;
}

/**
 * A tiny sorted set for the memory store.
 * @private
 */
class SortedSet {
  constructor() {
    this.scores = new Map();
  }

  add(member, score) {
    this.scores.set(member, score);
  }

  remove(member) {
    return this.scores.delete(member);
  }

  has(member) {
    return this.scores.has(member);
  }

  /** Members with score <= max, lowest score first. */
  upTo(max, limit = Infinity) {
    const out = [];
    for (const [member, score] of this.scores) {
      if (score <= max) out.push([member, score]);
    }
    out.sort((a, b) => a[1] - b[1]);
    return out.slice(0, limit).map(([member]) => member);
  }

  get size() {
    return this.scores.size;
  }

  countUpTo(max) {
    let n = 0;
    for (const score of this.scores.values()) if (score <= max) n += 1;
    return n;
  }
}

/**
 * In-process job store. Not shared between processes and not durable.
 */
class MemoryJobStore {
  /**
   * @param {Object=} options - `{ keepCompletedMs, maxCompleted }`
   */
  constructor(options = {}) {
    this.jobs_ = new Map();
    this.queues_ = new Map();
    this.dedupe_ = new Map();
    this.finished_ = [];
    this.keepCompletedMs_ = options.keepCompletedMs ?? 24 * 60 * 60 * 1000;
    this.maxCompleted_ = options.maxCompleted ?? 1000;
    this.durable = false;
  }

  /** @private */
  q_(queue) {
    if (!this.queues_.has(queue)) {
      this.queues_.set(queue, {
        ready: PRIORITIES.map(() => new SortedSet()),
        active: new SortedSet(),
        dead: []
      });
    }
    return this.queues_.get(queue);
  }

  async save(job) {
    this.jobs_.set(job.id, JSON.parse(JSON.stringify(job)));
    if (job.state === 'completed' || job.state === 'failed') {
      this.finished_.push({ id: job.id, at: Date.now() });
      this.pruneFinished_();
    }
  }

  /** @private */
  pruneFinished_() {
    const cutoff = Date.now() - this.keepCompletedMs_;
    while (this.finished_.length > this.maxCompleted_ || (this.finished_[0] && this.finished_[0].at < cutoff)) {
      const { id } = this.finished_.shift();
      const job = this.jobs_.get(id);
      if (job && (job.state === 'completed' || job.state === 'failed')) this.jobs_.delete(id);
    }
  }

  async get(id) {
    const job = this.jobs_.get(id);
    return job ? JSON.parse(JSON.stringify(job)) : null;
  }

  async remove(queue, id) {
    const q = this.q_(queue);
    q.ready.forEach((set) => set.remove(id));
    q.active.remove(id);
    q.dead = q.dead.filter((d) => d !== id);
    return this.jobs_.delete(id);
  }

  async schedule(queue, id, availableAt, priority) {
    const q = this.q_(queue);
    q.active.remove(id);
    q.ready[priorityRank(priority)].add(id, availableAt);
  }

  async claim(queue, now, deadline) {
    const q = this.q_(queue);
    for (const set of q.ready) {
      const [id] = set.upTo(now, 1);
      if (id !== undefined) {
        set.remove(id);
        q.active.add(id, deadline);
        return id;
      }
    }
    return null;
  }

  async touch(queue, id, deadline) {
    const q = this.q_(queue);
    if (q.active.has(id)) q.active.add(id, deadline);
  }

  async ack(queue, id) {
    this.q_(queue).active.remove(id);
  }

  async bury(queue, id) {
    const q = this.q_(queue);
    q.active.remove(id);
    if (!q.dead.includes(id)) q.dead.push(id);
  }

  async listDead(queue, limit = 100) {
    return this.q_(queue).dead.slice(0, limit);
  }

  async unbury(queue, id) {
    const q = this.q_(queue);
    const before = q.dead.length;
    q.dead = q.dead.filter((d) => d !== id);
    return q.dead.length !== before;
  }

  async expired(queue, now) {
    const q = this.q_(queue);
    const ids = q.active.upTo(now);
    ids.forEach((id) => q.active.remove(id));
    return ids;
  }

  async reserveKey(queue, key, id, windowMs) {
    const k = `${queue}\u0000${key}`;
    const hit = this.dedupe_.get(k);
    if (hit && hit.until > Date.now()) return hit.id;
    this.dedupe_.set(k, { id, until: Date.now() + windowMs });
    return null;
  }

  async counts(queue, now) {
    const q = this.q_(queue);
    const waiting = q.ready.reduce((n, set) => n + set.countUpTo(now), 0);
    const total = q.ready.reduce((n, set) => n + set.size, 0);
    return { waiting, delayed: total - waiting, active: q.active.size, dead: q.dead.length };
  }

  async queues() {
    return Array.from(this.queues_.keys());
  }

  async close() {}
}

// Lua scripts for the Redis store. KEYS are prefixed by ioredis's keyPrefix.

/** KEYS: ready high, normal, low, active. ARGV: now, deadline. Returns the claimed id or nil. */
const CLAIM_LUA = `
for i = 1, 3 do
  local ids = redis.call('ZRANGEBYSCORE', KEYS[i], '-inf', ARGV[1], 'LIMIT', 0, 1)
  if #ids > 0 then
    redis.call('ZREM', KEYS[i], ids[1])
    redis.call('ZADD', KEYS[4], ARGV[2], ids[1])
    return ids[1]
  end
end
return false
`;

/** KEYS: active. ARGV: now. Removes and returns the ids whose deadline passed. */
const EXPIRED_LUA = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
for _, id in ipairs(ids) do redis.call('ZREM', KEYS[1], id) end
return ids
`;

/**
 * Redis job store: durable and shared between processes.
 */
class RedisJobStore {
  /**
   * @param {!Object} client - ioredis client (its keyPrefix applies)
   * @param {Object=} options - `{ namespace, keepCompletedMs }`
   */
  constructor(client, options = {}) {
    this.client_ = client;
    this.ns_ = options.namespace || 'jobs';
    this.keepCompletedMs_ = options.keepCompletedMs ?? 24 * 60 * 60 * 1000;
    this.durable = true;
  }

  /** @private */
  key_(...parts) {
    return [this.ns_, ...parts].join(':');
  }

  /** @private */
  readyKeys_(queue) {
    return PRIORITIES.map((p) => this.key_('q', queue, 'ready', p));
  }

  async save(job) {
    const value = JSON.stringify(job);
    const key = this.key_('job', job.id);
    if (job.state === 'completed' || job.state === 'failed') {
      await this.client_.set(key, value, 'PX', this.keepCompletedMs_);
    } else {
      await this.client_.set(key, value);
    }
    await this.client_.sadd(this.key_('queues'), job.queue);
  }

  async get(id) {
    const value = await this.client_.get(this.key_('job', id));
    return value ? JSON.parse(value) : null;
  }

  async remove(queue, id) {
    const multi = this.client_.multi();
    this.readyKeys_(queue).forEach((k) => multi.zrem(k, id));
    multi.zrem(this.key_('q', queue, 'active'), id);
    multi.lrem(this.key_('q', queue, 'dead'), 0, id);
    multi.del(this.key_('job', id));
    const results = await multi.exec();
    return Boolean(results && results[results.length - 1][1]);
  }

  async schedule(queue, id, availableAt, priority) {
    await this.client_.multi()
      .zrem(this.key_('q', queue, 'active'), id)
      .zadd(this.readyKeys_(queue)[priorityRank(priority)], availableAt, id)
      .exec();
  }

  async claim(queue, now, deadline) {
    const id = await this.client_.eval(CLAIM_LUA, 4, ...this.readyKeys_(queue), this.key_('q', queue, 'active'), now, deadline);
    return id || null;
  }

  async touch(queue, id, deadline) {
    await this.client_.zadd(this.key_('q', queue, 'active'), 'XX', deadline, id);
  }

  async ack(queue, id) {
    await this.client_.zrem(this.key_('q', queue, 'active'), id);
  }

  async bury(queue, id) {
    await this.client_.multi()
      .zrem(this.key_('q', queue, 'active'), id)
      .lrem(this.key_('q', queue, 'dead'), 0, id)
      .rpush(this.key_('q', queue, 'dead'), id)
      .exec();
  }

  async listDead(queue, limit = 100) {
    return this.client_.lrange(this.key_('q', queue, 'dead'), 0, limit - 1);
  }

  async unbury(queue, id) {
    return (await this.client_.lrem(this.key_('q', queue, 'dead'), 0, id)) > 0;
  }

  async expired(queue, now) {
    return (await this.client_.eval(EXPIRED_LUA, 1, this.key_('q', queue, 'active'), now)) || [];
  }

  async reserveKey(queue, key, id, windowMs) {
    const k = this.key_('dedupe', queue, key);
    const ok = await this.client_.set(k, id, 'PX', windowMs, 'NX');
    if (ok) return null;
    return (await this.client_.get(k)) || null;
  }

  async counts(queue, now) {
    const multi = this.client_.multi();
    const ready = this.readyKeys_(queue);
    ready.forEach((k) => multi.zcount(k, '-inf', now));
    ready.forEach((k) => multi.zcard(k));
    multi.zcard(this.key_('q', queue, 'active'));
    multi.llen(this.key_('q', queue, 'dead'));
    const r = (await multi.exec()).map(([, v]) => Number(v));
    const waiting = r[0] + r[1] + r[2];
    return { waiting, delayed: r[3] + r[4] + r[5] - waiting, active: r[6], dead: r[7] };
  }

  async queues() {
    return this.client_.smembers(this.key_('queues'));
  }

  async close() {}
}

module.exports = { MemoryJobStore, RedisJobStore, PRIORITIES, priorityRank };
