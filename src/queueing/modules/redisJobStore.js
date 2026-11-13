/**
 * @fileoverview Redis job store for reliable jobs (feature 06). Each operation
 * that must be atomic is a Lua script, so a claim, ack or fail cannot be split
 * by another client or a crash.
 *
 * Keys per queue `q`, all prefixed by the client's keyPrefix:
 * - `jobs:q:docs`      hash of id -> job JSON
 * - `jobs:q:ready`     sorted set of ready ids, scored by priority and arrival
 * - `jobs:q:delayed`   sorted set of ids waiting for runAt (delays and retries)
 * - `jobs:q:active`    sorted set of ids, scored by lease expiry
 * - `jobs:q:dead`      sorted set of dead ids, scored by time of death
 * - `jobs:q:completed` sorted set of completed ids, trimmed to a retention count
 * - `jobs:q:seq`       arrival counter
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const LUA_INSERT = `
local seq = redis.call('INCR', KEYS[4])
local doc = cjson.decode(ARGV[2])
doc.score = tonumber(ARGV[3]) * 10000000000 + seq
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(doc))
if ARGV[4] == '1' then
  redis.call('ZADD', KEYS[3], ARGV[5], ARGV[1])
else
  redis.call('ZADD', KEYS[2], doc.score, ARGV[1])
end
return doc.score
`;

// KEYS: docs, ready, delayed, active, dead. ARGV: now, leaseMs
const LUA_CLAIM = `
local now = tonumber(ARGV[1])
local lease = tonumber(ARGV[2])
local due = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 100)
for _, id in ipairs(due) do
  redis.call('ZREM', KEYS[3], id)
  local doc = cjson.decode(redis.call('HGET', KEYS[1], id))
  doc.state = 'waiting'
  redis.call('ZADD', KEYS[2], doc.score, id)
  redis.call('HSET', KEYS[1], id, cjson.encode(doc))
end
local expired = redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now, 'LIMIT', 0, 100)
for _, id in ipairs(expired) do
  redis.call('ZREM', KEYS[4], id)
  local doc = cjson.decode(redis.call('HGET', KEYS[1], id))
  doc.leaseUntil = 0
  doc.lastError = 'visibility timeout expired'
  if doc.attempts >= doc.maxAttempts then
    doc.state = 'dead'
    doc.deadAt = now
    redis.call('ZADD', KEYS[5], now, id)
  else
    doc.state = 'waiting'
    redis.call('ZADD', KEYS[2], doc.score, id)
  end
  redis.call('HSET', KEYS[1], id, cjson.encode(doc))
end
local top = redis.call('ZRANGE', KEYS[2], 0, 0)
if #top == 0 then return nil end
local id = top[1]
redis.call('ZREM', KEYS[2], id)
local doc = cjson.decode(redis.call('HGET', KEYS[1], id))
doc.attempts = doc.attempts + 1
doc.state = 'active'
doc.leaseUntil = now + lease
redis.call('ZADD', KEYS[4], doc.leaseUntil, id)
redis.call('HSET', KEYS[1], id, cjson.encode(doc))
return cjson.encode(doc)
`;

// KEYS: docs, active, completed. ARGV: id, now, retention
const LUA_ACK = `
redis.call('ZREM', KEYS[2], ARGV[1])
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local doc = cjson.decode(raw)
doc.state = 'completed'
doc.completedAt = tonumber(ARGV[2])
doc.leaseUntil = 0
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(doc))
redis.call('ZADD', KEYS[3], ARGV[2], ARGV[1])
local keep = tonumber(ARGV[3])
local excess = redis.call('ZRANGE', KEYS[3], 0, -(keep + 1))
for _, old in ipairs(excess) do
  redis.call('ZREM', KEYS[3], old)
  redis.call('HDEL', KEYS[1], old)
end
return 1
`;

// KEYS: docs, active, delayed, dead. ARGV: id, now, error, retryAt (0 = dead)
const LUA_FAIL = `
redis.call('ZREM', KEYS[2], ARGV[1])
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local doc = cjson.decode(raw)
doc.lastError = ARGV[3]
doc.leaseUntil = 0
local retryAt = tonumber(ARGV[4])
if retryAt > 0 then
  doc.state = 'failed'
  doc.runAt = retryAt
  redis.call('ZADD', KEYS[3], retryAt, ARGV[1])
else
  doc.state = 'dead'
  doc.deadAt = tonumber(ARGV[2])
  redis.call('ZADD', KEYS[4], ARGV[2], ARGV[1])
end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(doc))
return 1
`;

// KEYS: docs, ready, dead. ARGV: now
const LUA_RETRY_DEAD = `
local ids = redis.call('ZRANGE', KEYS[3], 0, -1)
for _, id in ipairs(ids) do
  redis.call('ZREM', KEYS[3], id)
  local doc = cjson.decode(redis.call('HGET', KEYS[1], id))
  doc.attempts = 0
  doc.state = 'waiting'
  doc.lastError = ''
  doc.deadAt = 0
  redis.call('ZADD', KEYS[2], doc.score, id)
  redis.call('HSET', KEYS[1], id, cjson.encode(doc))
end
return #ids
`;

/**
 * Creates a job store on a connected ioredis client.
 *
 * @param {import('ioredis').Redis} client ioredis client (its keyPrefix applies to every key)
 * @param {Object=} options
 * @param {function(): Promise<void>=} options.ensure Awaited before each operation (lazy connection)
 * @param {number=} options.completedRetention Completed jobs kept per queue
 * @return {Object} Store with the methods the engine uses
 */
function createRedisJobStore(client, options = {}) {
  const ensure = options.ensure || (async () => {});
  const retention = options.completedRetention ?? 1000;
  const keys = (queue) => ({
    docs: `jobs:${queue}:docs`,
    ready: `jobs:${queue}:ready`,
    delayed: `jobs:${queue}:delayed`,
    active: `jobs:${queue}:active`,
    dead: `jobs:${queue}:dead`,
    completed: `jobs:${queue}:completed`,
    seq: `jobs:${queue}:seq`
  });

  if (!client.nooblyjsJobInsert) {
    client.defineCommand('nooblyjsJobInsert', { numberOfKeys: 4, lua: LUA_INSERT });
    client.defineCommand('nooblyjsJobClaim', { numberOfKeys: 5, lua: LUA_CLAIM });
    client.defineCommand('nooblyjsJobAck', { numberOfKeys: 3, lua: LUA_ACK });
    client.defineCommand('nooblyjsJobFail', { numberOfKeys: 4, lua: LUA_FAIL });
    client.defineCommand('nooblyjsJobRetryDead', { numberOfKeys: 3, lua: LUA_RETRY_DEAD });
  }

  return {
    async insert(doc, placement) {
      await ensure();
      const k = keys(doc.queue);
      const stored = { ...doc };
      await client.nooblyjsJobInsert(
        k.docs, k.ready, k.delayed, k.seq,
        doc.id, JSON.stringify(stored), String(placement.rank), placement.delayed ? '1' : '0', String(placement.runAt)
      );
    },

    async claimDedupe(queueName, key, ttlMs, id) {
      await ensure();
      const dedupeKey = `jobs:${queueName}:dedupe:${key}`;
      const set = await client.set(dedupeKey, id, 'PX', ttlMs, 'NX');
      if (set === 'OK') return null;
      return client.get(dedupeKey);
    },

    async claim(queueName, now, leaseMs) {
      await ensure();
      const k = keys(queueName);
      const raw = await client.nooblyjsJobClaim(k.docs, k.ready, k.delayed, k.active, k.dead, String(now), String(leaseMs));
      return raw ? JSON.parse(raw) : null;
    },

    async ack(queueName, id, now) {
      await ensure();
      const k = keys(queueName);
      await client.nooblyjsJobAck(k.docs, k.active, k.completed, id, String(now), String(retention));
    },

    async fail(queueName, id, error, retryAt, now) {
      await ensure();
      const k = keys(queueName);
      await client.nooblyjsJobFail(k.docs, k.active, k.delayed, k.dead, id, String(now), String(error), String(retryAt));
    },

    async get(id, queueName) {
      await ensure();
      if (!queueName) return null;
      const raw = await client.hget(keys(queueName).docs, id);
      return raw ? JSON.parse(raw) : null;
    },

    async retryDead(queueName, now) {
      await ensure();
      const k = keys(queueName);
      return client.nooblyjsJobRetryDead(k.docs, k.ready, k.dead, String(now));
    },

    async counts(queueName) {
      await ensure();
      const k = keys(queueName);
      const [waiting, delayed, active, completed, dead] = await Promise.all([
        client.zcard(k.ready), client.zcard(k.delayed), client.zcard(k.active),
        client.zcard(k.completed), client.zcard(k.dead)
      ]);
      return { waiting, delayed, active, completed, dead };
    }
  };
}

module.exports = { createRedisJobStore };
