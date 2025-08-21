/**
 * @fileoverview Load test for logging service performance.
 * 
 * This load test measures the performance of logging operations across
 * different logging providers (console, file). Tests help evaluate logging
 * throughput and identify performance bottlenecks in high-volume scenarios.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createLogger = require('../../../src/logging');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;

/**
 * Executes load test for logging service performance.
 * 
 * Runs a series of log operations to measure performance characteristics
 * of different logging providers under high-volume scenarios.
 * 
 * @async
 * @function runLoggingLoadTest
 * @param {number} iterations - Number of log operations to perform
 * @param {string} [loggerType='console'] - Type of logging provider to test
 * @param {Object} [options={}] - Configuration options for the logging provider
 * @returns {Promise<Object>} Test results including service, type, iterations, and duration
 */
async function runLoggingLoadTest(
  iterations,
  loggerType = 'console',
  options = {},
) {
  const eventEmitter = new EventEmitter();
  const logger = createLogger(loggerType, options, eventEmitter);
  const logFilePath = path.join(__dirname, 'load_test.log');

  const startTime = Date.now();
  console.log(
    `Starting Logging Load Test (${loggerType} logger) for ${iterations} iterations...`,
  );

  if (loggerType === 'file') {
    await fs.writeFile(logFilePath, '').catch(() => {}); // Clear log file
  }

  for (let i = 0; i < iterations; i++) {
    logger.log(`Log message ${i}: This is a test log entry.`);
    if (i % 1000 === 0) {
      // console.log(`Logging iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Logging Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );

  if (loggerType === 'file') {
    await fs.unlink(logFilePath).catch(() => {}); // Clean up log file
  }

  return { service: 'logging', type: loggerType, iterations, duration };
}

module.exports = runLoggingLoadTest;
