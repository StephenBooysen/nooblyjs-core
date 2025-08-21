/**
 * @fileoverview Load test for queueing service performance.
 * 
 * This load test measures the performance of queue operations including
 * enqueue and dequeue operations. Tests help evaluate queue throughput
 * and identify performance characteristics under high-volume scenarios.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createQueue = require('../../../src/queueing');
const EventEmitter = require('events');

/**
 * Executes load test for queueing service performance.
 * 
 * Runs a series of enqueue and dequeue operations to measure performance
 * characteristics of the queue system under high-volume scenarios.
 * 
 * @async
 * @function runQueueingLoadTest
 * @param {number} iterations - Number of queue operations to perform
 * @returns {Promise<Object>} Test results including service, iterations, and duration
 */
async function runQueueingLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const queue = createQueue('memory', {}, eventEmitter);

  const startTime = Date.now();
  console.log(`Starting Queueing Load Test for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    queue.enqueue(`item-${i}`);
    if (i % 2 === 0) {
      queue.dequeue(); // Dequeue some items to simulate real-world usage
    }
    if (i % 1000 === 0) {
      // console.log(`Queueing iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Queueing Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'queueing', iterations, duration };
}

module.exports = runQueueingLoadTest;
