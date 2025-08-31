/**
 * @fileoverview Load test for MongoDB dataserve service performance.
 * 
 * This load test measures the performance of MongoDB dataserve operations including
 * container creation, object addition, retrieval, searching, and removal operations.
 * Tests help identify performance bottlenecks and scalability limits.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createDataserve = require('../../../src/dataserve');
const EventEmitter = require('events');

/**
 * Executes load test for MongoDB dataserve service performance.
 * 
 * Runs a series of dataserve operations to measure performance
 * characteristics of the MongoDB provider under load.
 * 
 * @async
 * @function runMongoDBLoadTest
 * @param {number} iterations - Number of dataserve operations to perform
 * @param {Object} [options={}] - Configuration options for the MongoDB provider
 * @returns {Promise<Object>} Test results including service, type, iterations, and duration
 */
async function runMongoDBLoadTest(iterations, options = {}) {
  const eventEmitter = new EventEmitter();
  const mongoOptions = {
    database: 'nooblyjs_load_test',
    connectionString: 'mongodb://127.0.0.1:27017',
    ...options
  };
  
  const dataserve = createDataserve('mongodb', mongoOptions, eventEmitter);
  const containerName = 'load_test_container';
  
  console.log(`Starting MongoDB DataServe Load Test for ${iterations} iterations...`);
  console.log(`Database: ${mongoOptions.database}`);
  
  const startTime = Date.now();
  const results = {
    service: 'dataserve',
    type: 'mongodb',
    iterations,
    operations: {
      createContainer: { count: 0, duration: 0 },
      add: { count: 0, duration: 0 },
      get: { count: 0, duration: 0 },
      find: { count: 0, duration: 0 },
      remove: { count: 0, duration: 0 }
    }
  };

  try {
    // Phase 1: Create container
    console.log('Phase 1: Creating container...');
    const createStartTime = Date.now();
    await dataserve.createContainer(containerName);
    results.operations.createContainer.count = 1;
    results.operations.createContainer.duration = Date.now() - createStartTime;

    // Phase 2: Add operations
    console.log('Phase 2: Adding objects...');
    const addStartTime = Date.now();
    const objectKeys = [];
    
    for (let i = 0; i < iterations; i++) {
      const testObject = {
        id: i,
        name: `TestObject${i}`,
        category: i % 3 === 0 ? 'electronics' : i % 3 === 1 ? 'books' : 'clothing',
        price: Math.floor(Math.random() * 1000) + 10,
        description: `This is test object number ${i} with some searchable text`,
        metadata: {
          created: new Date().toISOString(),
          tags: [`tag${i % 5}`, 'test', 'load-test']
        }
      };
      
      const key = await dataserve.add(containerName, testObject);
      objectKeys.push(key);
      results.operations.add.count++;
      
      if (i % 100 === 0 && i > 0) {
        console.log(`Added ${i}/${iterations} objects`);
      }
    }
    
    results.operations.add.duration = Date.now() - addStartTime;
    console.log(`Add operations completed: ${results.operations.add.count} in ${results.operations.add.duration} ms`);

    // Phase 3: Get operations
    console.log('Phase 3: Retrieving objects...');
    const getStartTime = Date.now();
    
    for (let i = 0; i < Math.min(iterations, 100); i++) {
      const randomIndex = Math.floor(Math.random() * objectKeys.length);
      await dataserve.getByUuid(containerName, objectKeys[randomIndex]);
      results.operations.get.count++;
    }
    
    results.operations.get.duration = Date.now() - getStartTime;
    console.log(`Get operations completed: ${results.operations.get.count} in ${results.operations.get.duration} ms`);

    // Phase 4: Search operations
    console.log('Phase 4: Search operations...');
    const findStartTime = Date.now();
    
    const searchTerms = ['electronics', 'books', 'test', 'TestObject1', 'tag0'];
    for (const term of searchTerms) {
      await dataserve.find(containerName, term);
      results.operations.find.count++;
    }
    
    // Test advanced search methods
    await dataserve.jsonFindByPath(containerName, 'category', 'electronics');
    await dataserve.jsonFindByCriteria(containerName, { category: 'books' });
    results.operations.find.count += 2;
    
    results.operations.find.duration = Date.now() - findStartTime;
    console.log(`Find operations completed: ${results.operations.find.count} in ${results.operations.find.duration} ms`);

    // Phase 5: Remove operations (remove 10% of objects)
    console.log('Phase 5: Remove operations...');
    const removeStartTime = Date.now();
    const removeCount = Math.floor(iterations * 0.1);
    
    for (let i = 0; i < removeCount; i++) {
      const keyToRemove = objectKeys[i];
      await dataserve.remove(containerName, keyToRemove);
      results.operations.remove.count++;
    }
    
    results.operations.remove.duration = Date.now() - removeStartTime;
    console.log(`Remove operations completed: ${results.operations.remove.count} in ${results.operations.remove.duration} ms`);

    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // Calculate performance metrics
    results.duration = totalDuration;
    results.operationsPerSecond = (iterations * 2) / (totalDuration / 1000); // Add + Get operations
    results.avgAddTime = results.operations.add.duration / results.operations.add.count;
    results.avgGetTime = results.operations.get.count > 0 ? results.operations.get.duration / results.operations.get.count : 0;
    results.avgFindTime = results.operations.find.duration / results.operations.find.count;
    results.avgRemoveTime = results.operations.remove.count > 0 ? results.operations.remove.duration / results.operations.remove.count : 0;

    console.log('MongoDB DataServe Load Test Results:');
    console.log(`- Total duration: ${totalDuration} ms`);
    console.log(`- Operations per second: ${results.operationsPerSecond.toFixed(2)}`);
    console.log(`- Average add time: ${results.avgAddTime.toFixed(2)} ms`);
    console.log(`- Average get time: ${results.avgGetTime.toFixed(2)} ms`);
    console.log(`- Average find time: ${results.avgFindTime.toFixed(2)} ms`);
    console.log(`- Average remove time: ${results.avgRemoveTime.toFixed(2)} ms`);

    return results;

  } finally {
    // Clean up - close MongoDB connection
    if (dataserve.provider && typeof dataserve.provider.close === 'function') {
      try {
        await dataserve.provider.close();
        console.log('MongoDB connection closed');
      } catch (error) {
        console.warn('Error closing MongoDB connection:', error.message);
      }
    }
  }
}

/**
 * Executes MongoDB load test with different scenarios.
 * 
 * @async
 * @function runComprehensiveMongoDBLoadTest
 * @param {number} baseIterations - Base number of iterations for each test phase
 * @returns {Promise<Array>} Array of test results for different scenarios
 */
async function runComprehensiveMongoDBLoadTest(baseIterations = 500) {
  console.log('Starting Comprehensive MongoDB DataServe Load Test...');
  const testResults = [];

  // Test 1: Standard load test
  console.log('\n=== Test 1: Standard Load Test ===');
  testResults.push(await runMongoDBLoadTest(baseIterations, { testName: 'standard' }));

  // Test 2: High volume test with smaller iterations
  console.log('\n=== Test 2: High Volume Test ===');
  testResults.push(await runMongoDBLoadTest(baseIterations * 2, { testName: 'high-volume' }));

  console.log('\n=== Comprehensive Load Test Summary ===');
  testResults.forEach((result, index) => {
    const testName = result.testName || `test-${index + 1}`;
    console.log(`${testName}: ${result.operationsPerSecond.toFixed(2)} ops/sec (${result.duration}ms total)`);
  });

  return testResults;
}

module.exports = { 
  runMongoDBLoadTest,
  runComprehensiveMongoDBLoadTest
};