'use strict';

/**
 * @fileoverview Shared state for horizontal scaling (feature 21).
 *
 * Security state (login failure counts, lockouts, invitations) and scheduler
 * claims must be shared by every replica. Process-local Maps are not enough:
 * with N replicas an attacker gets N times the allowance. This module gives
 * one small interface over two implementations:
 *   - memory: one process only (the default; behaviour is unchanged)
 *   - redis:  shared by all replicas (set `cluster.redisUrl`)
 *
 * Values are JSON. Every method is async, so the memory and Redis
 * implementations are interchangeable.
 *
 * @module shared/utils/stateStore
 */

const crypto = require('node:crypto');

/**
 * Lua script that increments a counter and sets its expiry on the first
 * increment, in one atomic step.
 * @type {string}
 */
const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

/**
 * Process-local implementation. Expired entries are removed when read.
 */
class MemoryStateStore {
  constructor() {
    this.entries_ = new Map();
    this.kind = 'memory';
  }

  /**
   * Returns the live entry for a key, removing it when it has expired.
   *
   * @param {string} key
   * @return {?{value: *, expiresAt: number}}
   * @private
   */
  live_(key) {
    const entry = this.entries_.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.entries_.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * @param {string} key
   * @return {Promise<*>} The value, or null when absent or expired
   */
  async get(key) {
    const entry = this.live_(key);
    return entry ? structuredClone(entry.value) : null;
  }

  /**
   * @param {string} key
   * @param {*} value JSON-serialisable value
   * @param {number=} ttlMs Expiry in milliseconds; omit for no expiry
   * @return {Promise<void>}
   */
  async set(key, value, ttlMs) {
    this.entries_.set(key, {
      value: structuredClone(value),
      expiresAt: ttlMs ? Date.now() + ttlMs : 0
    });
  }

  /**
   * Stores a value only when the key is free. Returns true when this call stored it.
   *
   * @param {string} key
   * @param {*} value
   * @param {number} ttlMs Expiry in milliseconds
   * @return {Promise<boolean>}
   */
  async setIfAbsent(key, value, ttlMs) {
    if (this.live_(key)) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  /**
   * Increments a counter. The expiry is set on the first increment only, so a
   * window is fixed from its first event.
   *
   * @param {string} key
   * @param {number} ttlMs Window length in milliseconds
   * @return {Promise<number>} The new count
   */
  async incr(key, ttlMs) {
    const entry = this.live_(key);
    if (!entry) {
      await this.set(key, 1, ttlMs);
      return 1;
    }
    entry.value = Number(entry.value) + 1;
    return entry.value;
  }

  /**
   * @param {string} key
   * @return {Promise<boolean>} True when a key was removed
   */
  async del(key) {
    return this.entries_.delete(key);
  }

  /**
   * Releases resources. Nothing to release in memory.
   * @return {Promise<void>}
   */
  async close() {
    this.entries_.clear();
  }
}

/**
 * Redis implementation. Keys are prefixed, so one Redis can serve several apps.
 */
class RedisStateStore {
  /**
   * @param {Object} client An ioredis client
   * @param {Object=} options
   * @param {string=} options.prefix Key prefix (default 'nooblyjs:state:')
   */
  constructor(client, options = {}) {
    this.client_ = client;
    this.prefix_ = options.prefix || 'nooblyjs:state:';
    this.kind = 'redis';
  }

  /**
   * @param {string} key
   * @return {string} The prefixed key
   * @private
   */
  k_(key) {
    return `${this.prefix_}${key}`;
  }

  /** @return {Promise<*>} */
  async get(key) {
    const raw = await this.client_.get(this.k_(key));
    return raw === null ? null : JSON.parse(raw);
  }

  /** @return {Promise<void>} */
  async set(key, value, ttlMs) {
    const raw = JSON.stringify(value);
    if (ttlMs) {
      await this.client_.set(this.k_(key), raw, 'PX', ttlMs);
    } else {
      await this.client_.set(this.k_(key), raw);
    }
  }

  /** @return {Promise<boolean>} */
  async setIfAbsent(key, value, ttlMs) {
    const result = await this.client_.set(this.k_(key), JSON.stringify(value), 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  /** @return {Promise<number>} */
  async incr(key, ttlMs) {
    return Number(await this.client_.eval(INCR_WITH_TTL, 1, this.k_(key), ttlMs));
  }

  /** @return {Promise<boolean>} */
  async del(key) {
    return (await this.client_.del(this.k_(key))) > 0;
  }

  /** @return {Promise<void>} */
  async close() {
    await this.client_.quit().catch(() => {});
  }
}

/**
 * Creates the state store for a configuration.
 *
 * @param {Object=} cluster The `cluster` option of the registry
 * @param {string=} cluster.redisUrl Redis URL; when set, state is shared through Redis
 * @param {Object=} cluster.redisClient A ready ioredis client (used instead of redisUrl, for tests)
 * @return {MemoryStateStore|RedisStateStore}
 */
function createStateStore(cluster = {}) {
  if (cluster && cluster.redisClient) return new RedisStateStore(cluster.redisClient, cluster);
  if (cluster && cluster.redisUrl) {
    const Redis = require('ioredis');
    const client = new Redis(cluster.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
    return new RedisStateStore(client, cluster);
  }
  return new MemoryStateStore();
}

/**
 * A stable, non-reversible key part for personal data such as an email.
 * Keeps addresses out of Redis key names.
 *
 * @param {string} value
 * @return {string} Hex SHA-256
 */
function keyPart(value) {
  return crypto.createHash('sha256').update(String(value).toLowerCase()).digest('hex');
}

/**
 * A store for express-rate-limit (v7 Store interface) on top of the shared
 * state store, so per-IP limits count across replicas. Hits are counted in a
 * window that starts at the first hit.
 */
class SharedRateLimitStore {
  /**
   * @param {Object} stateStore Shared state store
   * @param {number} windowMs Window length in milliseconds
   * @param {string=} prefix Key prefix, so each limiter has its own counters
   */
  constructor(stateStore, windowMs, prefix = 'rl:') {
    this.store_ = stateStore;
    this.windowMs_ = windowMs;
    this.prefix_ = prefix;
    this.localKeys = false;
  }

  /** @param {string} key @return {string} */
  k_(key) {
    return `${this.prefix_}${key}`;
  }

  /** @return {void} */
  init() {}

  /**
   * @param {string} key Client key, such as an IP address
   * @return {Promise<{totalHits: number, resetTime: Date}>}
   */
  async increment(key) {
    const totalHits = await this.store_.incr(this.k_(key), this.windowMs_);
    return { totalHits, resetTime: new Date(Date.now() + this.windowMs_) };
  }

  /** @return {Promise<void>} */
  async decrement(key) {
    const current = Number(await this.store_.get(this.k_(key))) || 0;
    if (current > 0) await this.store_.set(this.k_(key), current - 1, this.windowMs_);
  }

  /** @return {Promise<void>} */
  async resetKey(key) {
    await this.store_.del(this.k_(key));
  }
}

module.exports = {
  INCR_WITH_TTL,
  MemoryStateStore,
  RedisStateStore,
  SharedRateLimitStore,
  createStateStore,
  keyPart
};
