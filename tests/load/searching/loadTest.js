/**
 * @fileoverview Load test for search service performance.
 * 
 * This load test measures the performance of search operations including
 * data indexing and search query execution. Tests help evaluate search
 * performance and scalability under high-volume query scenarios.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createSearchService = require('../../../src/searching');
const EventEmitter = require('events');

/**
 * Executes load test for search service performance.
 * 
 * Pre-populates the search index with test data, then runs a series of
 * search queries to measure performance characteristics under load.
 * 
 * @async
 * @function runSearchingLoadTest
 * @param {number} iterations - Number of search operations to perform
 * @returns {Promise<Object>} Test results including service, iterations, and duration
 */
async function runSearchingLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const searchService = createSearchService('default', {}, eventEmitter);

  // Pre-populate with some data
  for (let i = 0; i < iterations / 10; i++) {
    // Add less data than iterations to simulate real search
    searchService.add(`item-${i}`, {
      id: i,
      name: `Product ${i}`,
      description: `Description for product ${i} with keyword ${i % 5 === 0 ? 'special' : 'normal'}`,
    });
  }

  const startTime = Date.now();
  console.log(`Starting Searching Load Test for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    const searchTerm = `product ${Math.floor(Math.random() * (iterations / 10))}`;
    searchService.search(searchTerm);
    if (i % 1000 === 0) {
      // console.log(`Searching iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Searching Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'searching', iterations, duration };
}

module.exports = runSearchingLoadTest;
