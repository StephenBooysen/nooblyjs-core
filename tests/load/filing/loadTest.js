/**
 * @fileoverview Load test for filing service performance.
 * 
 * This load test measures the performance of file operations including
 * file creation, reading, and deletion across different filing providers
 * (local, FTP, S3). Tests help evaluate file I/O performance and scalability.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createFilingService = require('../../../src/filing');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;

/**
 * Executes load test for filing service performance.
 * 
 * Runs a series of file operations including creation and reading to measure
 * performance characteristics of different filing providers under load.
 * 
 * @async
 * @function runFilingLoadTest
 * @param {number} iterations - Number of file operations to perform
 * @param {string} [filingType='local'] - Type of filing provider to test
 * @param {Object} [options={}] - Configuration options for the filing provider
 * @returns {Promise<Object>} Test results including service, type, iterations, and duration
 */
async function runFilingLoadTest(
  iterations,
  filingType = 'local',
  options = {},
) {
  const eventEmitter = new EventEmitter();
  const filing = createFilingService(filingType, options, eventEmitter);
  const testDir = path.join(__dirname, 'filing_load_test_data');

  const startTime = Date.now();
  console.log(
    `Starting Filing Load Test (${filingType} filing) for ${iterations} iterations...`,
  );

  if (filingType === 'local') {
    await fs.mkdir(testDir, { recursive: true }).catch(() => {});
  }

  for (let i = 0; i < iterations; i++) {
    const filePath =
      filingType === 'local'
        ? path.join(testDir, `file-${i}.txt`)
        : `file-${i}.txt`;
    const content = `This is content for file ${i} - ${Math.random()}`;
    await filing.create(filePath, content);
    await filing.read(filePath);
    // await filing.delete(filePath); // Optional: if you want to test deletion load
    if (i % 100 === 0) {
      // console.log(`Filing iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Filing Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );

  if (filingType === 'local') {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  }

  return { service: 'filing', type: filingType, iterations, duration };
}

module.exports = runFilingLoadTest;
