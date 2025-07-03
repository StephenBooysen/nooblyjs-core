/**
 * @fileoverview Worker thread for load testing.
 */

const {parentPort} = require('worker_threads');
const createCache = require('../src/caching');
const createLogger = require('../src/logging');
const createQueue = require('../src/queueing');

/**
 * Runs a load test for a specified duration.
 * @param {number} duration The duration of the test in milliseconds.
 */
async function runLoadTest(duration) {
  const cache = createCache('memory');
  const logger = createLogger('console');
  const queue = createQueue('memory');

  const startTime = Date.now();
  let operations = 0;

  while (Date.now() - startTime < duration) {
    // Test caching
    const cacheKey = `key-${Math.random()}`;
    const cacheValue = `value-${Math.random()}`;
    cache.put(cacheKey, cacheValue);
    cache.get(cacheKey);

    // Test logging
    logger.log(`Log message ${operations}`);

    // Test queueing
    queue.enqueue(`Queue item ${operations}`);
    queue.dequeue();

    operations++;
  }

  parentPort.postMessage({operations});
}

parentPort.on('message', (message) => {
  if (message.command === 'start') {
    runLoadTest(message.duration);
  }
});
