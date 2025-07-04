const createQueue = require('../../src/queueing');
const EventEmitter = require('events');

async function runQueueingLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const queue = createQueue('memory', {}, eventEmitter);

  const startTime = Date.now();
  console.log(`Starting Queueing Load Test for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    queue.enqueue(`item-${i}`);
    if (i % 2 === 0) {
      queue.dequeue(); // Dequeue some items to simulate real-world usage
    }
    if (i % 1000 === 0) {
      // console.log(`Queueing iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Queueing Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'queueing', iterations, duration };
}

module.exports = runQueueingLoadTest;
