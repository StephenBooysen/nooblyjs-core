const createFilingService = require('../../src/filing');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;

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
