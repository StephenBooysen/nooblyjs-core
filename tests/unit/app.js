/**
 * @fileoverview Application demonstrating NooblyJS Core services.
 * This file serves as a comprehensive example of how to use all available
 * services in the NooblyJS Core framework.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const serviceRegistry = require('../../index');
const { EventEmitter } = require('events');

/** @type {express.Application} Express application instance */
const app = express();
app.use(bodyParser.json());

/**
 * Initialize the service registry with the Express app.
 * This sets up all services and their REST endpoints.
 */
const eventEmitter = new EventEmitter();
patchEmitter(eventEmitter);
serviceRegistry.initialize(app, eventEmitter);

/**
 * Initialize core services from the registry.
 * Each service is configured with appropriate providers.
 */
const log = serviceRegistry.logger('console');
const cache = serviceRegistry.cache('memory');
const dataserve = serviceRegistry.dataServe('memory');
const filing = serviceRegistry.filing('local');
const queue = serviceRegistry.queue('memory');

dataserve.status;
filing.status;

/**
 * Demonstrate basic service operations.
 * Test caching, logging, and queueing functionality.
 */
cache.put('currentdate', new Date());
log.info(cache.get('currentdate'));
queue.enqueue(new Date());

/**
 * Demonstrate scheduling service.
 * Schedule a task to run with a 5-second delay.
 */
const scheduling = serviceRegistry.scheduling('memory');
scheduling.start(
  'Schedule task 1',
  '../../../tests/unit/working/exampleTask.js',
  { message: 'Life is fine' },
  5,
  (status, data) => {
    console.log(
      'Schedule task 1 executed with status:',
      status,
      'and data:',
      data,
    );
  },
);

/**
 * Demonstrate searching service.
 * Add sample users and perform a search operation.
 */
const searching = serviceRegistry.searching('memory');
searching.add(uuidv4(), { name: 'Jill', role: 'user', dob: '2025-02-01' });
searching.add(uuidv4(), { name: 'Frank', role: 'user', dob: '2025-03-01' });
searching.add(uuidv4(), { name: 'Bill', role: 'user', dob: '2025-04-01' });
searching.add(uuidv4(), { name: 'Ted', role: 'user', dob: '2025-05-01' });
searching.search('user');

/**
 * Demonstrate measuring service.
 * Add sample measurements and retrieve aggregated data.
 */
const measuring = serviceRegistry.measuring('memory');
console.log(measuring);
measuring.add('example-measure', 300);
measuring.add('example-measure', 150);
measuring.add('example-measure', 200);
const measureData = measuring.list(
  'example-measure',
  new Date('2025-01-01'),
  new Date('2025-12-31'),
);
console.log('Measure data:', measureData);

const totalData = measuring.total(
  'example-measure',
  new Date('2025-01-01'),
  new Date('2025-12-31'),
);
console.log('Total measure data:', totalData);

/**
 * Demonstrate notifying service.
 * Create a topic, add subscribers, and send notifications.
 */
const notifying = serviceRegistry.notifying('memory');
console.log(notifying);
notifying.createTopic('example-topic');
notifying.subscribe('example-topic', (message) => {
  console.log('Subscriber 1 Received message on example-topic:', message);
});
notifying.subscribe('example-topic', (message) => {
  console.log('Subscriber 2 Received message on example-topic:', message);
});
notifying.notify('example-topic', { text: 'Hello, World!' });
notifying.notify('example-topic', { text: 'Hello, World 2!' });

/**
 * Demonstrate working service (commented out).
 * This shows how to start background worker tasks.
 */
const worker = serviceRegistry.working('memory');
worker.start('../../../tests/working/exampleTask.js', () => {
  console.log('Worker task ended');
});

/**
 * Demonstrate workflow service.
 * Define a multi-step workflow and execute it.
 */
const workflow = serviceRegistry.workflow('memory');
const steps = [
  path.resolve(__dirname, './tests/unit/workflow/steps/exampleStep1.js'),
  path.resolve(__dirname, './tests/unit/workflow/steps/exampleStep2.js'),
];
workflow.defineWorkflow('example-workflow', steps);
workflow.runWorkflow('example-workflow', {}, () => {
  console.log('Workflow ended');
});

/**
 * Configure static file serving for multiple UI themes.
 * Each theme provides a different visual design for the web interface.
 */
app.use('/', express.static(__dirname + '/public'));

/** @type {number} Server port number */
const PORT = process.env.PORT || 3000;

/**
 * Start the Express server.
 * All services will be available via REST APIs and web interface.
 */
app.listen(PORT, () => {
  log.info(`Server is running on port ${PORT}`);
});

/**
 * Patch event emitter to capture all events for debugging
 */
function patchEmitter(eventEmitter) {
  const originalEmit = eventEmitter.emit;
  eventEmitter.emit = function () {
    const eventName = arguments[0];
    const args = Array.from(arguments).slice(1);
    console.log(`Caught event: "${eventName}" with arguments:`, args);
    return originalEmit.apply(this, arguments);
  };
}
