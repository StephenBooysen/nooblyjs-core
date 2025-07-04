const getWorkerInstance = require('../../src/working');
const EventEmitter = require('events');
const path = require('path');

async function runWorkingLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const worker = getWorkerInstance('default', {}, eventEmitter);
  const mockScriptPath = path.resolve(__dirname, './mockWorkerScript.js');

  // Create a dummy mockWorkerScript.js
  const fs = require('fs').promises;
  await fs.writeFile(
    mockScriptPath,
    "parentPort.postMessage({type: 'status', status: 'completed'});",
  );

  const startTime = Date.now();
  console.log(`Starting Working Load Test for ${iterations} iterations...`);

  let completedTasks = 0;
  const completionPromise = new Promise((resolve) => {
    eventEmitter.on('worker:status', (status) => {
      if (status.status === 'completed') {
        completedTasks++;
        if (completedTasks >= iterations) {
          resolve();
        }
      }
    });
  });

  for (let i = 0; i < iterations; i++) {
    worker.start(mockScriptPath, () => {});
    if (i % 100 === 0) {
      // console.log(`Working iteration ${i}`);
    }
  }

  await completionPromise;

  worker.stop();
  await fs.unlink(mockScriptPath); // Clean up dummy file

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Working Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'working', iterations, duration };
}

module.exports = runWorkingLoadTest;
