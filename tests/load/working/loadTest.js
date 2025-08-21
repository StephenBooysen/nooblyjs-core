/**
 * @fileoverview Load test for worker service performance.
 * 
 * This load test measures the performance of worker task execution including
 * worker spawning, task processing, and status reporting. Tests help evaluate
 * worker throughput and task execution performance under high concurrency.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const getWorkerInstance = require('../../../src/working');
const EventEmitter = require('events');
const path = require('path');

/**
 * Executes load test for worker service performance.
 * 
 * Creates mock worker scripts and runs worker task executions to measure
 * performance characteristics of worker processing under high load.
 * 
 * @async
 * @function runWorkingLoadTest
 * @param {number} iterations - Number of worker task executions to perform
 * @returns {Promise<Object>} Test results including service, iterations, and duration
 */
async function runWorkingLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const worker = getWorkerInstance('default', {}, eventEmitter);
  const mockScriptPath = path.resolve(__dirname, './mockWorkerScript.js');

  // Create a dummy mockWorkerScript.js
  const fs = require('fs').promises;
  await fs.writeFile(
    mockScriptPath,
    "parentPort.postMessage({type: 'status', status: 'completed'});",
  );

  const startTime = Date.now();
  console.log(`Starting Working Load Test for ${iterations} iterations...`);

  let completedTasks = 0;
  const completionPromise = new Promise((resolve) => {
    eventEmitter.on('worker:status', (status) => {
      if (status.status === 'completed') {
        completedTasks++;
        if (completedTasks >= iterations) {
          resolve();
        }
      }
    });
  });

  for (let i = 0; i < iterations; i++) {
    worker.start(mockScriptPath, () => {});
    if (i % 100 === 0) {
      // console.log(`Working iteration ${i}`);
    }
  }

  await completionPromise;

  worker.stop();
  await fs.unlink(mockScriptPath); // Clean up dummy file

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Working Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'working', iterations, duration };
}

module.exports = runWorkingLoadTest;
