const createNotificationService = require('../../src/notifying');
const EventEmitter = require('events');

async function runNotifyingLoadTest(iterations) {
  const eventEmitter = new EventEmitter();
  const notificationService = createNotificationService(
    'default',
    {},
    eventEmitter,
  );
  const topicName = 'loadTestTopic';

  notificationService.createTopic(topicName);

  // Subscribe a dummy listener to ensure there's something to notify
  notificationService.subscribe(topicName, (message) => {
    // console.log('Received:', message);
  });

  const startTime = Date.now();
  console.log(`Starting Notifying Load Test for ${iterations} iterations...`);

  for (let i = 0; i < iterations; i++) {
    notificationService.notify(topicName, `Message ${i}`);
    if (i % 1000 === 0) {
      // console.log(`Notifying iteration ${i}`);
    }
  }

  const endTime = Date.now();
  const duration = endTime - startTime;
  console.log(
    `Notifying Load Test Completed: ${iterations} operations in ${duration} ms.`,
  );
  return { service: 'notifying', iterations, duration };
}

module.exports = runNotifyingLoadTest;
