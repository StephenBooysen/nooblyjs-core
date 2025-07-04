const createCache = require('../../src/caching');
const EventEmitter = require('events');

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
