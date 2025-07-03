const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

// lets log
const log = require('./src/logging')();

// lets cache
const cache = require('./src/caching')('memory', { 'express-app': app });
cache.put('currentdate', new Date());
log.log(cache.get('currentdate'))

// lets queue
const queue = require('./src/queueing')('memory');
for (var i = 0 ; i <= 1000; i++){
    queue.enqueue(i)
}
var val = queue.dequeue()
while (val != null){
   log.log('Dequeued: ' + val)
   val = queue.dequeue() 
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log.log(`Server is running on port ${PORT}`);
});