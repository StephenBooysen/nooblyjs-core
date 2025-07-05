const EventEmitter = require('events');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

/**
 * Patch our emitter to capture all events
 * @param {} emitter
 */
function patchEmitter(emitter) {
  const originalEmit = emitter.emit;

  emitter.emit = function () {
    const eventName = arguments[0];
    const args = Array.from(arguments).slice(1); // Get arguments excluding the event name

    console.log(`Caught event: "${eventName}" with arguments:`, args);

    // Call the original emit method to ensure normal event handling continues
    return originalEmit.apply(this, arguments);
  };
}
const eventEmitter = new EventEmitter();
patchEmitter(eventEmitter);


// lets log
const log = require('./src/logging')('', { 'express-app': app }, eventEmitter);

// lets cache
const cache = require('./src/caching')(
  'memory',
  { 'express-app': app },
  eventEmitter,
);
cache.put('currentdate', new Date());
log.log(cache.get('currentdate'));

// lets queue
const queue = require('./src/queueing')(
  'memory',
  { 'express-app': app },
  eventEmitter,
);
queue.enqueue(new Date());


const seaching = require('./src/searching')(
  'memory',
  { 'express-app': app },
  eventEmitter,
);
const { v4: uuidv4 } = require('uuid');
seaching.add(uuidv4(), { name: 'Jill', role: 'user', dob: '2025-02-01' });
seaching.add(uuidv4(), { name: 'Frank', role: 'user', dob: '2025-03-01' });
seaching.add(uuidv4(), { name: 'Bill', role: 'user', dob: '2025-04-01' });
seaching.add(uuidv4(), { name: 'Ted', role: 'user', dob: '2025-05-01' });
seaching.search('user');

// lets measure
const measuring = require('./src/measuring')(
  'memory',
  { 'express-app': app },
  eventEmitter,
);
console.log(measuring);
measuring.add('example-measure', 300);
measuring.add('example-measure', 150);
measuring.add('example-measure', 200);
measuring.list('example-measure',new Date('2025-01-01'), new Date('2025-12-31')).then((data) => {console.log('Measure data:', data);});
measuring.total('example-measure',new Date('2025-01-01'), new Date('2025-12-31')).then((data) => {console.log('Measure data:', data);});

// lets notify
const notifying = require('./src/notifying')(
  'memory',
  { 'express-app': app },
  eventEmitter,
);
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
const worker = require('./src/working')(
  'memory',
  { 'express-app': app },
  eventEmitter,
);
worker.start('../../../tests/working/exampleTask.js',  () => {
  console.log('Example task ended');
});


// lets workflow
const workflow = require('./src/workflow')(
  'memory',
  { 'express-app': app },
  eventEmitter,
);
const steps = [
  path.resolve(__dirname, './tests/workflow/steps/exampleStep1.js'),
  path.resolve(__dirname, './tests/workflow/steps/exampleStep2.js'),
];
workflow.defineWorkflow('example-workflow', steps);
workflow.runWorkflow('example-workflow', {}, () => {
  console.log('Workdflow ended');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log.log(`Server is running on port ${PORT}`);
});
