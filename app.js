const EventEmitter = require('events');
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

        emitter.emit = function() {
            const eventName = arguments[0];
            const args = Array.from(arguments).slice(1); // Get arguments excluding the event name

            console.log(`Caught event: "${eventName}" with arguments:`, args);

            // Call the original emit method to ensure normal event handling continues
            return originalEmit.apply(this, arguments);
        };
}
var eventEmitter = new EventEmitter();
patchEmitter(eventEmitter);
eventEmitter.on('instance', (data) => {
  console.log(data.options);
});

// lets log
const log = require('./src/logging')('', { 'express-app': app },eventEmitter);

// lets cache
const cache = require('./src/caching')('memory', { 'express-app': app },eventEmitter);
cache.put('currentdate', new Date());
log.log(cache.get('currentdate'))

// lets queue
const queue = require('./src/queueing')('memory', { 'express-app': app },eventEmitter);
queue.enqueue(new Date());

const worker = require('./src/working')('memory', { 'express-app': app },eventEmitter);
worker.start("../../../tests/working/exampleTask.js", function(data){
  console.log("Example task ended");
})

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log.log(`Server is running on port ${PORT}`);
});