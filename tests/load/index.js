/**
 * @fileoverview Load test runner for all NooblyJS services.
 * 
 * This script orchestrates load testing across all NooblyJS service providers,
 * running performance tests on caching, data serving, filing, logging, measuring,
 * notifications, queueing, scheduling, searching, workflow, and worker services.
 * Supports both direct provider tests and HTTP API endpoint tests with API key authentication.
 * 
 * @author NooblyJS Team
 * @version 1.2.1
 * @since 1.0.0
 */

'use strict';

const runCachingLoadTest = require('./caching/loadTest');
const { runFileLoadTest } = require('./caching/fileLoadTest');
const runDataserveLoadTest = require('./dataserve/loadTest');
const { runMongoDBLoadTest } = require('./dataserve/mongodbLoadTest');
const { runDocumentDBLoadTest } = require('./dataserve/documentdbLoadTest');
const runFilingLoadTest = require('./filing/loadTest');
const runLoggingLoadTest = require('./logging/loadTest');
const runMeasuringLoadTest = require('./measuring/loadTest');
const runNotifyingLoadTest = require('./notifying/loadTest');
const runQueueingLoadTest = require('./queueing/loadTest');
const runSchedulingLoadTest = require('./scheduling/loadTest');
const runSearchingLoadTest = require('./searching/loadTest');
const runWorkflowLoadTest = require('./workflow/loadTest');
const runWorkingLoadTest = require('./working/loadTest');

// HTTP-based API load tests
const runHttpLoadTest = require('./http/httpLoadTest');

/**
 * Load test configuration
 */
const LOAD_TEST_CONFIG = {
  // Provider-level tests (direct service instance testing)
  provider: {
    enabled: process.env.TEST_PROVIDERS !== 'false',
    iterations: parseInt(process.env.PROVIDER_ITERATIONS) || 100
  },
  // HTTP API tests (testing actual REST endpoints with authentication)
  http: {
    enabled: process.env.TEST_HTTP !== 'false',
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
    apiKey: process.env.TEST_API_KEY || null,
    concurrency: parseInt(process.env.HTTP_CONCURRENCY) || 10,
    iterations: parseInt(process.env.HTTP_ITERATIONS) || 500,
    // Test scenarios
    scenarios: {
      quick: { iterations: 100, concurrency: 5 },
      standard: { iterations: 500, concurrency: 10 },
      stress: { iterations: 2000, concurrency: 50 },
      soak: { iterations: 10000, concurrency: 20 }
    }
  }
};

/**
 * Runs comprehensive load tests across all NooblyJS services.
 * 
 * Executes performance tests for each service provider with configurable
 * iteration counts. Tests multiple provider types where applicable and
 * aggregates results for performance analysis.
 * 
 * @async
 * @function runAllLoadTests
 * @param {string} [testType='all'] - Type of tests to run: 'provider', 'http', or 'all'
 * @param {string} [scenario='standard'] - Test scenario: 'quick', 'standard', 'stress', or 'soak'
 * @returns {Promise<void>} Promise that resolves when all tests complete
 */
async function runAllLoadTests(testType = 'all', scenario = 'standard') {
  console.log(`\n=== NooblyJS Core Load Testing Suite ===`);
  console.log(`Test Type: ${testType}`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Configuration:`, {
    provider: LOAD_TEST_CONFIG.provider,
    http: { ...LOAD_TEST_CONFIG.http, apiKey: LOAD_TEST_CONFIG.http.apiKey ? '***' : 'not-set' }
  });

  /** @type {Array<Object>} Array to store test results */
  const results = [];

  // Run provider-level tests
  if ((testType === 'all' || testType === 'provider') && LOAD_TEST_CONFIG.provider.enabled) {
    console.log('\n--- Running Provider-Level Load Tests ---');
    await runProviderLoadTests(results);
  }

  // Run HTTP API tests
  if ((testType === 'all' || testType === 'http') && LOAD_TEST_CONFIG.http.enabled) {
    console.log('\n--- Running HTTP API Load Tests ---');
    await runHttpApiLoadTests(results, scenario);
  }

  // Display comprehensive results
  displayLoadTestResults(results);
}

/**
 * Runs provider-level load tests (direct service instance testing)
 */
async function runProviderLoadTests(results) {
  const iterations = LOAD_TEST_CONFIG.provider.iterations;

  try {
    results.push(await runCachingLoadTest(iterations, 'memory'));
    results.push(await runFileLoadTest(iterations));
    // results.push(await runCachingLoadTest(iterations, 'redis', {url: 'redis://localhost:6379'})); // Uncomment if Redis is set up
    // results.push(await runCachingLoadTest(iterations, 'memcached', {url: 'localhost:11211'})); // Uncomment if Memcached is set up

    results.push(await runDataserveLoadTest(iterations, 'memory'));
    results.push(await runDataserveLoadTest(iterations, 'file'));
    results.push(await runMongoDBLoadTest(iterations));
    results.push(await runDocumentDBLoadTest(iterations));
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
  } catch (error) {
    console.error('Provider load test error:', error.message);
    results.push({
      service: 'provider-tests',
      error: error.message,
      duration: 0,
      iterations: 0
    });
  }
}

/**
 * Runs HTTP API load tests (testing REST endpoints with authentication)
 */
async function runHttpApiLoadTests(results, scenario) {
  const config = LOAD_TEST_CONFIG.http.scenarios[scenario] || LOAD_TEST_CONFIG.http.scenarios.standard;
  
  if (!LOAD_TEST_CONFIG.http.apiKey) {
    console.warn('⚠️  No API key provided. Set TEST_API_KEY environment variable for authenticated tests.');
    console.warn('   Running public endpoint tests only...');
  }

  try {
    // Run HTTP load tests for each service
    const httpTestConfig = {
      baseUrl: LOAD_TEST_CONFIG.http.baseUrl,
      apiKey: LOAD_TEST_CONFIG.http.apiKey,
      ...config
    };

    const httpResults = await runHttpLoadTest(httpTestConfig);
    results.push(...httpResults);
  } catch (error) {
    console.error('HTTP load test error:', error.message);
    results.push({
      service: 'http-tests',
      error: error.message,
      duration: 0,
      iterations: 0
    });
  }
}

/**
 * Displays comprehensive load test results with analysis
 */
function displayLoadTestResults(results) {
  console.log('\n=== LOAD TEST RESULTS SUMMARY ===');
  
  if (results.length === 0) {
    console.log('No tests were executed.');
    return;
  }

  // Separate successful and failed tests
  const successful = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);

  console.log(`\n✅ Successful Tests: ${successful.length}`);
  console.log(`❌ Failed Tests: ${failed.length}`);

  // Display successful results
  if (successful.length > 0) {
    console.log('\n--- Performance Results ---');
    successful.forEach((result) => {
      const opsPerSec = result.duration > 0 ? Math.round((result.iterations / result.duration) * 1000) : 0;
      const avgLatency = result.duration > 0 ? (result.duration / result.iterations).toFixed(2) : 0;
      
      console.log(
        `${result.service.padEnd(15)} (${(result.type || 'default').padEnd(8)}): ${result.iterations.toString().padStart(6)} ops in ${result.duration.toString().padStart(6)}ms | ${opsPerSec.toString().padStart(6)} ops/sec | ${avgLatency}ms avg`
      );
    });

    // Calculate overall statistics
    const totalOps = successful.reduce((sum, r) => sum + r.iterations, 0);
    const totalDuration = successful.reduce((sum, r) => sum + r.duration, 0);
    const avgOpsPerSec = Math.round((totalOps / totalDuration) * 1000);

    console.log('\n--- Overall Statistics ---');
    console.log(`Total Operations: ${totalOps.toLocaleString()}`);
    console.log(`Total Duration: ${totalDuration.toLocaleString()}ms`);
    console.log(`Average Throughput: ${avgOpsPerSec.toLocaleString()} ops/sec`);
  }

  // Display failed tests
  if (failed.length > 0) {
    console.log('\n--- Failed Tests ---');
    failed.forEach((result) => {
      console.log(`❌ ${result.service}: ${result.error}`);
    });
  }

  console.log('\n=== LOAD TEST COMPLETE ===\n');
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const testType = args[0] || 'all'; // 'provider', 'http', or 'all'
  const scenario = args[1] || 'standard'; // 'quick', 'standard', 'stress', or 'soak'

  // Validate arguments
  const validTestTypes = ['all', 'provider', 'http'];
  const validScenarios = ['quick', 'standard', 'stress', 'soak'];

  if (!validTestTypes.includes(testType)) {
    console.error(`Invalid test type: ${testType}. Valid options: ${validTestTypes.join(', ')}`);
    process.exit(1);
  }

  if (!validScenarios.includes(scenario)) {
    console.error(`Invalid scenario: ${scenario}. Valid options: ${validScenarios.join(', ')}`);
    process.exit(1);
  }

  // Execute load tests with CLI arguments
  runAllLoadTests(testType, scenario).catch((error) => {
    console.error('Load test failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runAllLoadTests,
  LOAD_TEST_CONFIG
};
