'use strict';

/**
 * Runs the queueing contract against a real Redis. Skipped unless
 * RUN_REDIS_TESTS=1 and REDIS_URL (for example redis://127.0.0.1:6379) are set.
 */
const { EventEmitter } = require('events');
const { runQueueContract } = require('./queue.contract');
const createQueue = require('../../src/queueing');

const enabled = process.env.RUN_REDIS_TESTS === '1' && Boolean(process.env.REDIS_URL);
const describeRedis = enabled ? describe : describe.skip;

describeRedis('redis queueing provider', () => {
  runQueueContract(
    'redis',
    () => {
      const url = new URL(process.env.REDIS_URL);
      return createQueue('redis', { redisurl: url.hostname, port: Number(url.port || 6379), dependencies: {} }, new EventEmitter());
    },
    // disconnect(), not quit(): a queue that never issued a command has no open connection to quit over.
    async (queue) => { queue?.client_?.disconnect?.(); }
  );
});
