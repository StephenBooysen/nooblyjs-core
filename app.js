// lets log
log = require('./src/logging')();

// lets cache
cache = require('./src/caching')('memory');;
cache.put('currentdate', new Date());
log.log(cache.get('currentdate'))

// lets queue
queue = require('./src/queueing')('memory');
for (var i = 0 ; i <= 1000; i++){
    queue.enqueue(i)
}
var val = queue.dequeue()
while (val != null){
   log.log('Dequeued: ' + val)
   val = queue.dequeue() 
}
