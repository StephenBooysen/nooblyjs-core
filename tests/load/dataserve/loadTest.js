/**
 * @fileoverview Load test for dataserve service performance.
 * 
 * This load test measures the performance of data serving operations including
 * container creation, data addition, and search operations across different
 * dataserve providers (memory, file, SimpleDB). Tests help evaluate data
 * handling performance and scalability.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createDataserveService = require('../../../src/dataserve');
const EventEmitter = require('events');

/**
 * Executes load test for dataserve service performance.
 * 
 * Runs a series of data operations including container creation, data addition,
 * and search operations to measure performance characteristics under load.
 * 
 * @async
 * @function runDataserveLoadTest
 * @param {number} iterations - Number of data operations to perform
 * @param {string} [dataserveType='memory'] - Type of dataserve provider to test
 * @param {Object} [options={}] - Configuration options for the dataserve provider
 * @returns {Promise<Object>} Test results including service, type, iterations, and duration
 */
async function runDataserveLoadTest(
  iterations,
  dataserveType = 'memory',
  options = {},
) {
  const eventEmitter = new EventEmitter();
  const dataserve = createDataserveService(
    dataserveType,
    options,
    eventEmitter,
  );
  const containerName = 'loadTestContainer';

  const startTime = Date.now();
  console.log(
    `Starting Dataserve Load Test (${dataserveType} dataserve) for ${iterations} iterations...`,
  );

  try {
    await dataserve.createContainer(containerName);
  } catch (e) {
    // Container might already exist in file-based or simpledb
  }

  for (let i = 0; i < iterations; i++) {
    const data = { id: i, value: `data-${i}-${Math.random()}` };
    const key = await dataserve.add(containerName, data);
    await dataserve.find(containerName, `data-${i}`);
    // await dataserve.remove(containerName, key); // Optional: if you want to test removal load
    if (i % 1000 === 0) {
      // console.log(`Dataserve iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Dataserve Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'dataserve', type: dataserveType, iterations, duration };
}

module.exports = runDataserveLoadTest;
