/**
 * @fileoverview Factory for creating queue instances.
 */

const InMemoryQueue = require('./providers/inMemoryQueue');

/**
 * Creates a queue instance based on the provided type.
 * @param {string} type The type of queue to create. Valid options are 'memory'.
 * @param {Object=} options The options for the queue.
 * @return {!InMemoryQueue} A queue instance.
 */
function createQueue(type, options, eventEmitter) {
  if (type === 'memory') {
    return new InMemoryQueue(eventEmitter);
  } else {
    throw new Error('Unsupported queue type: ' + type);
  }
}

module.exports = createQueue;
