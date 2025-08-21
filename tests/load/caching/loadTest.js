/**
 * @fileoverview Load test for caching service performance.
 * 
 * This load test measures the performance of cache operations including
 * put and get operations across different cache providers (memory, Redis,
 * Memcached). Tests help identify performance bottlenecks and scalability limits.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createCache = require('../../../src/caching');
const EventEmitter = require('events');

/**
 * Executes load test for caching service performance.
 * 
 * Runs a series of cache put and get operations to measure performance
 * characteristics of different cache providers under load.
 * 
 * @async
 * @function runCachingLoadTest
 * @param {number} iterations - Number of cache operations to perform
 * @param {string} [cacheType='memory'] - Type of cache provider to test
 * @param {Object} [options={}] - Configuration options for the cache provider
 * @returns {Promise<Object>} Test results including service, type, iterations, and duration
 */
async function runCachingLoadTest(
  iterations,
  cacheType = 'memory',
  options = {},
) {
  const eventEmitter = new EventEmitter();
  const cache = createCache(cacheType, options, eventEmitter);
  const startTime = Date.now();
  console.log(
    `Starting Caching Load Test (${cacheType} cache) for ${iterations} iterations...`,
  );

  for (let i = 0; i < iterations; i++) {
    const key = `testKey-${i}`;
    const value = `testValue-${i}-${Math.random()}`;
    await cache.put(key, value);
    await cache.get(key);
    if (i % 1000 === 0) {
      // console.log(`Caching iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Caching Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'caching', type: cacheType, iterations, duration };
}

module.exports = runCachingLoadTest;
