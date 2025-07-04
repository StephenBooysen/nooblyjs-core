/**
 * @fileoverview An in-memory queue implementation.
 */

/**
 * A class that implements an in-memory queue.
 */
class InMemoryQueue {
  /**
   * Initializes the in-memory queue.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Array<*>} */
    this.queue_ = [];
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds an item to the end of the queue.
   * @param {*} item The item to add to the queue.
   */
  async enqueue(item) {
    this.queue_.push(item);
    if (this.eventEmitter_) this.eventEmitter_.emit('queue:enqueue', { item });
  }

  /**
   * Removes and returns the item at the front of the queue.
   * @return {*} The item at the front of the queue, or undefined if the queue is empty.
   */
  async dequeue() {
    const item = this.queue_.shift();
    if (item && this.eventEmitter_)
      this.eventEmitter_.emit('queue:dequeue', { item });
    return item;
  }

  /**
   * Returns the number of items in the queue.
   * @return {number} The number of items in the queue.
   */
  async size() {
    return this.queue_.length;
  }
}

module.exports = InMemoryQueue;
