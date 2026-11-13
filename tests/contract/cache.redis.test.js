'use strict';

/**
 * Runs the caching contract against a real Redis. Skipped unless
 * RUN_REDIS_TESTS=1 and REDIS_URL (for example redis://127.0.0.1:6379) are set.
 * Start one with: docker run -d -p 6379:6379 redis:7-alpine
 */
const { EventEmitter } = require('events');
const { runCacheContract } = require('./cache.contract');
const createCache = require('../../src/caching');

const enabled = process.env.RUN_REDIS_TESTS === '1' && Boolean(process.env.REDIS_URL);
const describeRedis = enabled ? describe : describe.skip;

describeRedis('redis caching provider', () => {
  runCacheContract(
    'redis',
    () => {
      // The provider takes the host in `redisurl` and the port separately.
      const url = new URL(process.env.REDIS_URL);
      return createCache('redis', { redisurl: url.hostname, port: Number(url.port || 6379), dependencies: {} }, new EventEmitter());
    },
    async (cache) => { await cache?.client_?.quit?.().catch(() => {}); }
  );
});
