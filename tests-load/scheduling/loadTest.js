const getSchedulerInstance = require('../../src/scheduling');
const EventEmitter = require('events');
const path = require('path');

async function runSchedulingLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const scheduler = getSchedulerInstance('default', {}, eventEmitter);
  const mockScriptPath = path.resolve(__dirname, './mockScheduledTask.js');

  // Create a dummy mockScheduledTask.js
  const fs = require('fs').promises;
  await fs.writeFile(mockScriptPath, 'module.exports = () => {};');

  const startTime = Date.now();
  console.log(`Starting Scheduling Load Test for ${iterations} iterations...`);

  let completedTasks = 0;
  const completionPromise = new Promise((resolve) => {
    eventEmitter.on('scheduler:taskExecuted', () => {
      completedTasks++;
      if (completedTasks >= iterations) {
        resolve();
      }
    });
  });

  // Start the scheduler to run the mock script very quickly
  scheduler.start(mockScriptPath, 0.001); // Run every 1ms

  // Wait for all iterations to complete
  await completionPromise;

  scheduler.stop();
  await fs.unlink(mockScriptPath); // Clean up dummy file

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Scheduling Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'scheduling', iterations, duration };
}

module.exports = runSchedulingLoadTest;
