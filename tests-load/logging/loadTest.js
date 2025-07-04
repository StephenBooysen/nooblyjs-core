const createLogger = require('../../src/logging');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;

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
