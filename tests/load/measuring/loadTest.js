/**
 * @fileoverview Load test for measuring service performance.
 * 
 * This load test measures the performance of metric collection and aggregation
 * operations. Tests help evaluate the measuring service's ability to handle
 * high-volume metric data collection and calculation performance.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createMeasuringService = require('../../../src/measuring');
const EventEmitter = require('events');

/**
 * Executes load test for measuring service performance.
 * 
 * Runs a series of metric collection operations followed by aggregation
 * calculations to measure performance under high-volume data scenarios.
 * 
 * @async
 * @function runMeasuringLoadTest
 * @param {number} iterations - Number of metric operations to perform
 * @returns {Promise<Object>} Test results including service, iterations, and duration
 */
async function runMeasuringLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const measuringService = createMeasuringService('default', {}, eventEmitter);

  const startTime = Date.now();
  console.log(`Starting Measuring Load Test for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    measuringService.add('testMetric', Math.random() * 100);
    if (i % 1000 === 0) {
      // console.log(`Measuring iteration ${i}`);
    }
  }
  measuringService.total('testMetric', new Date(0), new Date());
  measuringService.average('testMetric', new Date(0), new Date());

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Measuring Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'measuring', iterations, duration };
}

module.exports = runMeasuringLoadTest;
