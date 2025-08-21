/**
 * @fileoverview Load test runner for all NooblyJS services.
 * 
 * This script orchestrates load testing across all NooblyJS service providers,
 * running performance tests on caching, data serving, filing, logging, measuring,
 * notifications, queueing, scheduling, searching, workflow, and worker services.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const runCachingLoadTest = require('./caching/loadTest');
const runDataserveLoadTest = require('./dataserve/loadTest');
const runFilingLoadTest = require('./filing/loadTest');
const runLoggingLoadTest = require('./logging/loadTest');
const runMeasuringLoadTest = require('./measuring/loadTest');
const runNotifyingLoadTest = require('./notifying/loadTest');
const runQueueingLoadTest = require('./queueing/loadTest');
const runSchedulingLoadTest = require('./scheduling/loadTest');
const runSearchingLoadTest = require('./searching/loadTest');
const runWorkflowLoadTest = require('./workflow/loadTest');
const runWorkingLoadTest = require('./working/loadTest');

/**
 * Runs comprehensive load tests across all NooblyJS services.
 * 
 * Executes performance tests for each service provider with configurable
 * iteration counts. Tests multiple provider types where applicable and
 * aggregates results for performance analysis.
 * 
 * @async
 * @function runAllLoadTests
 * @returns {Promise<void>} Promise that resolves when all tests complete
 */
async function runAllLoadTests() {
  /** @type {number} Number of iterations for each load test */
  const iterations = 100; // Adjust as needed
  /** @type {Array<Object>} Array to store test results */
  const results = [];

  console.log('\n--- Running Load Tests ---');

  results.push(await runCachingLoadTest(iterations, 'memory'));
  // results.push(await runCachingLoadTest(iterations, 'redis', {url: 'redis://localhost:6379'})); // Uncomment if Redis is set up
  // results.push(await runCachingLoadTest(iterations, 'memcached', {url: 'localhost:11211'})); // Uncomment if Memcached is set up

  results.push(await runDataserveLoadTest(iterations, 'memory'));
  results.push(await runDataserveLoadTest(iterations, 'file'));
  // results.push(await runDataserveLoadTest(iterations, 'simpledb', {region: 'us-east-1'})); // Uncomment if SimpleDB is set up

  results.push(await runFilingLoadTest(iterations, 'local'));
  // results.push(await runFilingLoadTest(iterations, 'ftp', {connectionString: {host: 'localhost', port: 21, user: 'user', password: 'password'}})); // Uncomment if FTP is set up
  // results.push(await runFilingLoadTest(iterations, 's3', {bucketName: 'your-s3-bucket', region: 'us-east-1'})); // Uncomment if S3 is set up

  results.push(await runLoggingLoadTest(iterations, 'console'));
  results.push(
    await runLoggingLoadTest(iterations, 'file', { filename: './test.log' }),
  );

  results.push(await runMeasuringLoadTest(iterations));
  results.push(await runNotifyingLoadTest(iterations));
  results.push(await runQueueingLoadTest(iterations));
  results.push(await runSchedulingLoadTest(iterations));
  results.push(await runSearchingLoadTest(iterations));
  results.push(await runWorkflowLoadTest(iterations / 10)); // Workflow is more intensive
  results.push(await runWorkingLoadTest(iterations));

  console.log('\n--- Load Test Summary ---');
  results.forEach((result) => {
    console.log(
      `Service: ${result.service} (Type: ${result.type || 'N/A'}): ${result.iterations} operations in ${result.duration} ms`,
    );
  });
}

// Execute all load tests and handle any errors
runAllLoadTests().catch((error) => {
  console.error('Load test failed:', error);
  process.exit(1);
});
