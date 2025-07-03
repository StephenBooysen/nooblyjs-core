/**
 * @fileoverview Main script for running load tests.
 */

const {Worker} = require('worker_threads');

const NUM_WORKERS = 4;
const TEST_DURATION = 5000; // milliseconds

/**
 * Runs the load test.
 */
async function runLoadTest() {
  console.log(`Running load test with ${NUM_WORKERS} workers for ${TEST_DURATION / 1000} seconds...`);

  const workers = [];
  const results = [];

  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(__dirname + '/worker.js');
    workers.push(worker);

    worker.on('message', (message) => {
      results.push(message);
      if (results.length === NUM_WORKERS) {
        const totalOperations = results.reduce((sum, result) => sum + result.operations, 0);
        console.log(`Load test finished. Total operations: ${totalOperations}`);
        process.exit(0);
      }
    });

    worker.on('error', (err) => {
      console.error(`Worker error: ${err}`);
      process.exit(1);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker stopped with exit code ${code}`);
      }
    });

    worker.postMessage({command: 'start', duration: TEST_DURATION});
  }
}

runLoadTest();
