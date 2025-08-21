/**
 * @fileoverview Load test for notification service performance.
 * 
 * This load test measures the performance of notification operations including
 * topic management, subscription handling, and message publishing. Tests help
 * evaluate notification throughput and subscriber callback execution performance.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createNotificationService = require('../../../src/notifying');
const EventEmitter = require('events');

/**
 * Executes load test for notification service performance.
 * 
 * Runs a series of notification publish operations to measure performance
 * characteristics of the notification system under high-volume scenarios.
 * 
 * @async
 * @function runNotifyingLoadTest
 * @param {number} iterations - Number of notification operations to perform
 * @returns {Promise<Object>} Test results including service, iterations, and duration
 */
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
