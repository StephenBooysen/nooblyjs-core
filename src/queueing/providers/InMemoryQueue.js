/**
 * @fileoverview An in-memory queue implementation providing FIFO data structure
 * with enqueue and dequeue operations and event emission support.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * A class that implements an in-memory queue with FIFO behavior.
 * Provides methods for enqueueing, dequeueing, and checking queue size.
 * @class
 */
class InMemoryQueue {
  /**
   * Initializes the in-memory queue with empty storage.
   * @param {Object=} options Configuration options (unused in this implementation).
   * @param {EventEmitter=} eventEmitter Optional event emitter for queue events.
   */
  constructor(options, eventEmitter) {
    /** @private @const {!Array<*>} */
    this.queue_ = [];
    /** @private @const {EventEmitter} */
    this.eventEmitter_ = eventEmitter;
  }

  /**
   * Adds an item to the end of the queue (enqueue operation).
   * @param {*} item The item to add to the queue.
   * @return {Promise<void>} A promise that resolves when the item is enqueued.
   */
  async enqueue(item) {
    this.queue_.push(item);
    if (this.eventEmitter_) this.eventEmitter_.emit('queue:enqueue', { item });
  }

  /**
   * Removes and returns the item at the front of the queue (dequeue operation).
   * @return {Promise<*>} A promise that resolves to the item at the front of the queue, or undefined if empty.
   */
  async dequeue() {
    const item = this.queue_.shift();
    if (item && this.eventEmitter_)
      this.eventEmitter_.emit('queue:dequeue', { item });
    return item;
  }

  /**
   * Returns the number of items in the queue.
   * @return {Promise<number>} A promise that resolves to the number of items in the queue.
   */
  async size() {
    return this.queue_.length;
  }
}

module.exports = InMemoryQueue;
