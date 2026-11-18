/**
 * @fileoverview Unit tests for the in-memory queue functionality.
 *
 * This test suite covers the in-memory queue provider, testing queue
 * operations including enqueue, dequeue, and size management with support
 * for multiple named queues. Tests verify proper FIFO behavior and event
 * emission for queue operations.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createQueue = require('../../../src/queueing');
const EventEmitter = require('events');

/**
 * Test suite for in-memory queue operations.
 *
 * Tests the in-memory queue functionality including FIFO operations,
 * size tracking, multiple named queues, and proper event emission for queue activities.
 */
describe('InMemoryQueue', () => {
  /** @type {Object} Queue instance for testing */
  let queue;
  /** @type {EventEmitter} Mock event emitter for testing queue events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh in-memory queue instance and event emitter spy.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    queue = createQueue('memory', {}, mockEventEmitter);
  });

  /**
   * Test queue enqueue and dequeue operations with named queues.
   *
   * Verifies that items can be added to and removed from a named queue
   * in FIFO order with proper event emission.
   */
  it('should enqueue and dequeue items from a named queue', async () => {
    await queue.enqueue('emailQueue', 'item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue:default', {
      queueName: 'emailQueue',
      item: 'item1',
    });
    await queue.enqueue('emailQueue', 'item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue:default', {
      queueName: 'emailQueue',
      item: 'item2',
    });
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    expect(await queue.dequeue('emailQueue')).toBe('item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue:default', {
      queueName: 'emailQueue',
      item: 'item1',
    });
    expect(await queue.dequeue('emailQueue')).toBe('item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue:default', {
      queueName: 'emailQueue',
      item: 'item2',
    });
    expect(await queue.size('emailQueue')).toBe(0);
  });

  /**
   * Test multiple independent queues.
   *
   * Verifies that different named queues operate independently
   * and maintain their own separate items.
   */
  it('should support multiple independent queues', async () => {
    await queue.enqueue('emailQueue', 'email1');
    await queue.enqueue('emailQueue', 'email2');
    await queue.enqueue('imageQueue', 'image1');
    await queue.enqueue('imageQueue', 'image2');
    await queue.enqueue('imageQueue', 'image3');

    expect(await queue.size('emailQueue')).toBe(2);
    expect(await queue.size('imageQueue')).toBe(3);

    expect(await queue.dequeue('emailQueue')).toBe('email1');
    expect(await queue.size('emailQueue')).toBe(1);
    expect(await queue.size('imageQueue')).toBe(3);

    expect(await queue.dequeue('imageQueue')).toBe('image1');
    expect(await queue.size('imageQueue')).toBe(2);
    expect(await queue.size('emailQueue')).toBe(1);
  });

  /**
   * Test queue behavior when empty.
   *
   * Verifies that dequeuing from an empty queue returns undefined
   * and does not emit dequeue events.
   */
  it('should return undefined when dequeuing from an empty queue', async () => {
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    expect(await queue.dequeue('emptyQueue')).toBeUndefined();
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      'queue:dequeue',
      expect.any(Object),
    );
  });

  /**
   * Test queue size tracking.
   *
   * Verifies that the queue correctly tracks its size as items
   * are enqueued and dequeued.
   */
  it('should return the correct size for a named queue', async () => {
    expect(await queue.size('testQueue')).toBe(0);
    await queue.enqueue('testQueue', 'item1');
    expect(await queue.size('testQueue')).toBe(1);
    await queue.enqueue('testQueue', 'item2');
    expect(await queue.size('testQueue')).toBe(2);
    await queue.dequeue('testQueue');
    expect(await queue.size('testQueue')).toBe(1);
  });

  /**
   * Test listing all queue names.
   *
   * Verifies that the listQueues method returns all created queue names.
   */
  it('should list all queue names', async () => {
    await queue.enqueue('emailQueue', 'item1');
    await queue.enqueue('imageQueue', 'item2');
    await queue.enqueue('dataQueue', 'item3');

    const queues = await queue.listQueues();
    expect(queues).toContain('emailQueue');
    expect(queues).toContain('imageQueue');
    expect(queues).toContain('dataQueue');
    expect(queues.length).toBe(3);
  });

  /**
   * Test purging a queue.
   *
   * Verifies that the purge method removes all items from a queue
   * and emits the appropriate event.
   */
  it('should purge a queue', async () => {
    await queue.enqueue('testQueue', 'item1');
    await queue.enqueue('testQueue', 'item2');
    await queue.enqueue('testQueue', 'item3');
    expect(await queue.size('testQueue')).toBe(3);

    mockEventEmitter.emit.mockClear();
    await queue.purge('testQueue');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:purge:default', {
      queueName: 'testQueue',
    });
    expect(await queue.size('testQueue')).toBe(0);
  });

  /**
   * Test that empty size returns 0 for non-existent queues.
   *
   * Verifies that checking size of a queue that was never created
   * returns 0 rather than throwing an error.
   */
  it('should return 0 for non-existent queue size', async () => {
    expect(await queue.size('nonExistentQueue')).toBe(0);
  });
});
