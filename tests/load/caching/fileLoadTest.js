/**
 * @fileoverview Load test for file-based caching service performance.
 * 
 * This load test measures the performance of file cache operations including
 * put, get, delete, and clear operations. Tests help identify performance
 * bottlenecks, I/O characteristics, and scalability limits of the file-based cache.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createCache = require('../../../src/caching');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Executes load test for file-based caching service performance.
 * 
 * Runs a series of cache put, get, and delete operations to measure performance
 * characteristics of the file-based cache provider under load. Also tests
 * bulk operations like clear and statistics gathering.
 * 
 * @async
 * @function runFileLoadTest
 * @param {number} iterations - Number of cache operations to perform
 * @param {Object} [options={}] - Configuration options for the cache provider
 * @returns {Promise<Object>} Test results including service, type, iterations, duration, and performance metrics
 */
async function runFileLoadTest(iterations, options = {}) {
  // Create temporary cache directory for load test
  const tempCacheDir = path.join(os.tmpdir(), `cache-load-test-${Date.now()}-${Math.random()}`);
  
  const eventEmitter = new EventEmitter();
  const cacheOptions = { 
    cacheDir: tempCacheDir,
    ...options 
  };
  const cache = createCache('file', cacheOptions, eventEmitter);
  
  console.log(`Starting File Cache Load Test for ${iterations} iterations...`);
  console.log(`Cache directory: ${tempCacheDir}`);
  
  const startTime = Date.now();
  const results = {
    service: 'caching',
    type: 'file',
    iterations,
    operations: {
      put: { count: 0, duration: 0 },
      get: { count: 0, duration: 0 },
      delete: { count: 0, duration: 0 },
      clear: { count: 0, duration: 0 },
      stats: { count: 0, duration: 0 }
    }
  };

  // Phase 1: Put operations
  console.log('Phase 1: Put operations...');
  const putStartTime = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const key = `testKey-${i}`;
    const value = `testValue-${i}-${Math.random()}`;
    await cache.put(key, value);
    results.operations.put.count++;
    
    if (i % 1000 === 0 && i > 0) {
      console.log(`Put operations: ${i}/${iterations}`);
    }
  }
  
  results.operations.put.duration = Date.now() - putStartTime;
  console.log(`Put operations completed: ${results.operations.put.count} in ${results.operations.put.duration} ms`);

  // Phase 2: Get operations
  console.log('Phase 2: Get operations...');
  const getStartTime = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const key = `testKey-${i}`;
    await cache.get(key);
    results.operations.get.count++;
    
    if (i % 1000 === 0 && i > 0) {
      console.log(`Get operations: ${i}/${iterations}`);
    }
  }
  
  results.operations.get.duration = Date.now() - getStartTime;
  console.log(`Get operations completed: ${results.operations.get.count} in ${results.operations.get.duration} ms`);

  // Phase 3: Stats operations (periodic during load)
  console.log('Phase 3: Statistics gathering...');
  const statsStartTime = Date.now();
  
  for (let i = 0; i < Math.min(100, iterations); i++) {
    await cache.getStats();
    results.operations.stats.count++;
  }
  
  results.operations.stats.duration = Date.now() - statsStartTime;
  console.log(`Stats operations completed: ${results.operations.stats.count} in ${results.operations.stats.duration} ms`);

  // Phase 4: Random delete operations (delete 10% of entries)
  console.log('Phase 4: Delete operations...');
  const deleteStartTime = Date.now();
  const deleteCount = Math.floor(iterations * 0.1);
  
  for (let i = 0; i < deleteCount; i++) {
    const randomIndex = Math.floor(Math.random() * iterations);
    const key = `testKey-${randomIndex}`;
    await cache.delete(key);
    results.operations.delete.count++;
  }
  
  results.operations.delete.duration = Date.now() - deleteStartTime;
  console.log(`Delete operations completed: ${results.operations.delete.count} in ${results.operations.delete.duration} ms`);

  // Phase 5: Final statistics and cleanup test
  console.log('Phase 5: Final operations...');
  const clearStartTime = Date.now();
  
  const finalStats = await cache.getStats();
  console.log(`Final cache stats: ${finalStats.fileCount} files, ${finalStats.totalSize} bytes`);
  
  // Test analytics
  const analytics = cache.getAnalytics();
  console.log(`Analytics entries: ${analytics.length}`);
  
  // Clear all cache entries
  await cache.clear();
  results.operations.clear.count = 1;
  results.operations.clear.duration = Date.now() - clearStartTime;
  
  const endTime = Date.now();
  const totalDuration = endTime - startTime;
  
  // Calculate performance metrics
  results.duration = totalDuration;
  results.operationsPerSecond = (iterations * 2) / (totalDuration / 1000); // Put + Get operations
  results.avgPutTime = results.operations.put.duration / results.operations.put.count;
  results.avgGetTime = results.operations.get.duration / results.operations.get.count;
  results.avgDeleteTime = results.operations.delete.count > 0 ? results.operations.delete.duration / results.operations.delete.count : 0;
  results.finalStats = finalStats;

  console.log('File Cache Load Test Results:');
  console.log(`- Total duration: ${totalDuration} ms`);
  console.log(`- Operations per second: ${results.operationsPerSecond.toFixed(2)}`);
  console.log(`- Average put time: ${results.avgPutTime.toFixed(2)} ms`);
  console.log(`- Average get time: ${results.avgGetTime.toFixed(2)} ms`);
  console.log(`- Average delete time: ${results.avgDeleteTime.toFixed(2)} ms`);
  console.log(`- Peak file count: ${finalStats.fileCount}`);
  console.log(`- Peak cache size: ${finalStats.totalSize} bytes`);

  // Clean up test directory
  try {
    await fs.rm(tempCacheDir, { recursive: true, force: true });
    console.log(`Cleaned up test directory: ${tempCacheDir}`);
  } catch (error) {
    console.warn(`Failed to clean up test directory: ${error.message}`);
  }

  return results;
}

/**
 * Executes a comprehensive load test with multiple phases and different data sizes.
 * 
 * @async
 * @function runComprehensiveFileLoadTest  
 * @param {number} baseIterations - Base number of iterations for each test phase
 * @returns {Promise<Array>} Array of test results for different scenarios
 */
async function runComprehensiveFileLoadTest(baseIterations = 1000) {
  console.log('Starting Comprehensive File Cache Load Test...');
  const testResults = [];

  // Test 1: Small payloads (strings)
  console.log('\n=== Test 1: Small String Payloads ===');
  testResults.push(await runFileLoadTest(baseIterations, { testName: 'small-strings' }));

  // Test 2: Medium payloads (objects)
  console.log('\n=== Test 2: Medium Object Payloads ===');
  const eventEmitter = new EventEmitter();
  const tempCacheDir = path.join(os.tmpdir(), `cache-load-test-objects-${Date.now()}`);
  const cache = createCache('file', { cacheDir: tempCacheDir }, eventEmitter);
  
  const mediumTestStart = Date.now();
  for (let i = 0; i < Math.floor(baseIterations / 2); i++) {
    const mediumObject = {
      id: i,
      name: `test-object-${i}`,
      data: new Array(100).fill(0).map((_, idx) => `data-${idx}`),
      metadata: {
        created: new Date().toISOString(),
        size: 100,
        type: 'test-object'
      }
    };
    await cache.put(`obj-${i}`, mediumObject);
    await cache.get(`obj-${i}`);
  }
  const mediumTestDuration = Date.now() - mediumTestStart;
  
  testResults.push({
    service: 'caching',
    type: 'file',
    testName: 'medium-objects',
    iterations: Math.floor(baseIterations / 2),
    duration: mediumTestDuration,
    operationsPerSecond: (baseIterations) / (mediumTestDuration / 1000)
  });

  await cache.clear();
  await fs.rm(tempCacheDir, { recursive: true, force: true });

  // Test 3: High concurrency simulation
  console.log('\n=== Test 3: Concurrent Operations Simulation ===');
  const concurrentTestStart = Date.now();
  const concurrentCache = createCache('file', { 
    cacheDir: path.join(os.tmpdir(), `cache-load-test-concurrent-${Date.now()}`)
  }, eventEmitter);

  const concurrentPromises = [];
  const concurrentIterations = Math.floor(baseIterations / 10);
  
  for (let i = 0; i < concurrentIterations; i++) {
    concurrentPromises.push(
      (async (index) => {
        await concurrentCache.put(`concurrent-${index}`, `value-${index}`);
        await concurrentCache.get(`concurrent-${index}`);
        if (index % 2 === 0) {
          await concurrentCache.delete(`concurrent-${index}`);
        }
      })(i)
    );
  }

  await Promise.all(concurrentPromises);
  const concurrentTestDuration = Date.now() - concurrentTestStart;
  
  testResults.push({
    service: 'caching',
    type: 'file',
    testName: 'concurrent-operations',
    iterations: concurrentIterations,
    duration: concurrentTestDuration,
    operationsPerSecond: (concurrentIterations * 2) / (concurrentTestDuration / 1000)
  });

  await concurrentCache.clear();

  console.log('\n=== Comprehensive Load Test Summary ===');
  testResults.forEach((result, index) => {
    console.log(`Test ${index + 1} (${result.testName || result.type}): ${result.operationsPerSecond.toFixed(2)} ops/sec`);
  });

  return testResults;
}

module.exports = { 
  runFileLoadTest, 
  runComprehensiveFileLoadTest 
};