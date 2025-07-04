const createDataserveService = require('../../src/dataserve');
const EventEmitter = require('events');

async function runDataserveLoadTest(
  iterations,
  dataserveType = 'memory',
  options = {},
) {
  const eventEmitter = new EventEmitter();
  const dataserve = createDataserveService(
    dataserveType,
    options,
    eventEmitter,
  );
  const containerName = 'loadTestContainer';

  const startTime = Date.now();
  console.log(
    `Starting Dataserve Load Test (${dataserveType} dataserve) for ${iterations} iterations...`,
  );

  try {
    await dataserve.createContainer(containerName);
  } catch (e) {
    // Container might already exist in file-based or simpledb
  }

  for (let i = 0; i < iterations; i++) {
    const data = { id: i, value: `data-${i}-${Math.random()}` };
    const key = await dataserve.add(containerName, data);
    await dataserve.find(containerName, `data-${i}`);
    // await dataserve.remove(containerName, key); // Optional: if you want to test removal load
    if (i % 1000 === 0) {
      // console.log(`Dataserve iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Dataserve Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'dataserve', type: dataserveType, iterations, duration };
}

module.exports = runDataserveLoadTest;
