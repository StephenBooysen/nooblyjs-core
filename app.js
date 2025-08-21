const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const serviceRegistry = require('./index');

const app = express();
app.use(bodyParser.json());

// Initialize the service registry with the Express app
serviceRegistry.initialize(app);

// Get services from the registry
const log = serviceRegistry.logger('console');
const cache = serviceRegistry.cache('memory');
const queue = serviceRegistry.queue('memory');

// Test the services
cache.put('currentdate', new Date());
log.log(cache.get('currentdate'));
queue.enqueue(new Date());

const scheduling = serviceRegistry.scheduling('memory');
scheduling.start(
  'Schedule task 1',
  '../../../tests/unit/working/exampleTask.js',
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

scheduling.start(
  'Schedule task 2',
  '../../../tests/unit/working/exampleTask.js',
  5,
  (status, data) => {
    console.log(
      'Schedule task 2 executed with status:',
      status,
      'and data:',
      data,
    );
  },
);

const searching = serviceRegistry.searching('memory');
const { v4: uuidv4 } = require('uuid');
searching.add(uuidv4(), { name: 'Jill', role: 'user', dob: '2025-02-01' });
searching.add(uuidv4(), { name: 'Frank', role: 'user', dob: '2025-03-01' });
searching.add(uuidv4(), { name: 'Bill', role: 'user', dob: '2025-04-01' });
searching.add(uuidv4(), { name: 'Ted', role: 'user', dob: '2025-05-01' });
searching.search('user');

// lets measure
const measuring = serviceRegistry.measuring('memory');
console.log(measuring);
measuring.add('example-measure', 300);
measuring.add('example-measure', 150);
measuring.add('example-measure', 200);
measuring
  .list('example-measure', new Date('2025-01-01'), new Date('2025-12-31'))
  .then((data) => {
    console.log('Measure data:', data);
  });
measuring
  .total('example-measure', new Date('2025-01-01'), new Date('2025-12-31'))
  .then((data) => {
    console.log('Measure data:', data);
  });

// lets notify
const notifying = serviceRegistry.notifying('memory');
console.log(notifying);
notifying.createTopic('example-topic');
notifying.subscribe('example-topic', (message) => {
  console.log('Subsriber 1 Received message on example-topic:', message);
});
notifying.subscribe('example-topic', (message) => {
  console.log('Subscriber 2 Received message on example-topic:', message);
});
notifying.notify('example-topic', { text: 'Hello, World!' });
notifying.notify('example-topic', { text: 'Hello, World 2!' });

// lets work
const worker = serviceRegistry.working('memory');
worker.start('../../../tests/working/exampleTask.js', () => {
  console.log('Worker  task ended');
});

// lets workflow
const workflow = serviceRegistry.workflow('memory');
const steps = [
  path.resolve(__dirname, './tests/unit/workflow/steps/exampleStep1.js'),
  path.resolve(__dirname, './tests/unit/workflow/steps/exampleStep2.js'),
];
workflow.defineWorkflow('example-workflow', steps);
workflow.runWorkflow('example-workflow', {}, () => {
  console.log('Workdflow ended');
});

app.use('/', express.static(__dirname + '/ui-design/home-glass'));
app.use('/flat', express.static(__dirname + '/ui-design/home-flat'));
app.use('/material', express.static(__dirname + '/ui-design/home-material'));
app.use(
  '/minimalist',
  express.static(__dirname + '/ui-design/home-minimalist'),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log.log(`Server is running on port ${PORT}`);
});
