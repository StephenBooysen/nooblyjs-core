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
const serviceRegistry = require('./index');
const { EventEmitter } = require('events');
const config = require('dotenv').config();

/** @type {express.Application} Express application instance */
const app = express();
app.use(bodyParser.json());

/**
 * Initialize the service registry with the Express app.
 * This sets up all services and their REST endpoints.
 */
const eventEmitter = new EventEmitter();
serviceRegistry.initialize(app, eventEmitter);

/**
 * Initialize core services from the registry.
 * Each service is configured with appropriate providers.
 */
const log = serviceRegistry.logger('file');
const cache = serviceRegistry.cache('inmemory');
const dataserve = serviceRegistry.dataServe('file');
const filing = serviceRegistry.filing('local');
const queue = serviceRegistry.queue('memory');
const scheduling = serviceRegistry.scheduling('memory');
const searching = serviceRegistry.searching('memory');
const measuring = serviceRegistry.measuring('memory');
const notifying = serviceRegistry.notifying('memory');
const worker = serviceRegistry.working('memory');
const workflow = serviceRegistry.workflow('memory');
const aiservice = serviceRegistry.aiservice('claude', {
  apiKey: process.env.aiapikey
});

cache.put('currentdate', new Date());
log.info(cache.get('currentdate'));
queue.enqueue(new Date());

filing.create("./.files/text.txt","Hello World");
filing.read("./.files/text.txt", "utf8").then(content => {
    console.log("File content:", content);
  }).catch(error => {
    console.error("Error reading file:", error);
  });

loadExampleDataserve(dataserve);
loadExampleScheduling(scheduling);
loadExampleSearching(searching);
loadExampleMeasuring(measuring);
loadExampleNotifying(notifying);
loadExampleWorker(worker);
loadExampleWorflow(workflow);
loadExampleAiService(aiservice);

const PORT = process.env.PORT || 3001;
app.use('/', express.static(__dirname + '/public'));
app.listen(PORT, () => {
  log.info(`Server is running on port ${PORT}`);
});


/**
* Demonstrate dataserve service.
* Same a user object
*/
function loadExampleDataserve(dataserve){
  dataserve.createContainer('users');
  var key = dataserve.add('users',{'username':'stephen','fullname':'Stephen Booysen'});
  console.log(key);
}

/**
* Demonstrate scheduling service.
* Schedule a task to run with a 5-second delay.
*/
function loadExampleScheduling(scheduling){
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
}

/**
 * Demonstrate searching service.
 * Add sample users and perform a search operation.
 */
function loadExampleSearching(searchng){
  searching.add(uuidv4(), { name: 'Jill', role: 'user', dob: '2025-02-01' });
  searching.add(uuidv4(), { name: 'Frank', role: 'user', dob: '2025-03-01' });
  searching.add(uuidv4(), { name: 'Bill', role: 'user', dob: '2025-04-01' });
  searching.add(uuidv4(), { name: 'Ted', role: 'user', dob: '2025-05-01' });
  searching.search('user');
}

/**
 * Demonstrate measuring service.
 * Add sample measurements and retrieve aggregated data.
 */
function loadExampleMeasuring(measuring){
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
}


/**
 * Demonstrate notifying service.
 * Create a topic, add subscribers, and send notifications.
 */
function loadExampleNotifying(notifying){
    notifying.createTopic('example-topic');
    notifying.subscribe('example-topic', (message) => {
      console.log('Subscriber 1 Received message on example-topic:', message);
    });
    notifying.subscribe('example-topic', (message) => {
      console.log('Subscriber 2 Received message on example-topic:', message);
    });
    notifying.notify('example-topic', { text: 'Hello, World!' });
    notifying.notify('example-topic', { text: 'Hello, World 2!' });
  }

  /**
 * Demonstrate working service (commented out).
 * This shows how to start background worker tasks.
 */
function loadExampleWorker(worker){
  worker.start('../../../tests/working/exampleTask.js', () => {
    console.log('Worker task ended');
  });
}

/**
 * Demonstrate workflow service.
 * Define a multi-step workflow and execute it.
 */
function loadExampleWorflow(workflow){
  const steps = [
    path.resolve(__dirname, './tests/unit/workflow/steps/exampleStep1.js'),
    path.resolve(__dirname, './tests/unit/workflow/steps/exampleStep2.js'),
  ];
  workflow.defineWorkflow('example-workflow', steps);
  workflow.runWorkflow('example-workflow', {}, () => {
    console.log('Workflow ended');
  });
}

/**
 * Demonstrate AI service.
 * Send a test prompt to the Claude AI service.
 */
async function loadExampleAiService(aiservice) {
  try {
    console.log('Testing Claude AI service...');
    const response = await aiservice.prompt('Hello, can you tell me what you are?', {
      maxTokens: 150,
      temperature: 0.7
    });
    console.log('AI Service Response:', response.content);
    console.log('Token Usage:', response.usage);
  } catch (error) {
    console.error('AI Service Error:', error.message);
  }
}