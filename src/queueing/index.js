/**
 * @fileoverview Factory for creating queue instances.
 */

const InMemoryQueue = require('./providers/InMemoryQueue');
const Routes = require('./routes');

/**
 * Creates a queue instance based on the provided type.
 * @param {string} type The type of queue to create. Valid options are 'memory'.
 * @param {Object=} options The options for the queue.
 * @return {!InMemoryQueue} A queue instance.
 */
function createQueue(type, options, eventEmitter) {
  if (type === 'memory') {
    const queue = new InMemoryQueue(options, eventEmitter);
    Routes(options, eventEmitter, queue);
    return queue;
  } else {
    throw new Error('Unsupported queue type: ' + type);
  }
}

module.exports = createQueue;
