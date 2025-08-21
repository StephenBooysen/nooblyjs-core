/**
 * @fileoverview Unit tests for the in-memory queue functionality.
 * 
 * This test suite covers the in-memory queue provider, testing queue
 * operations including enqueue, dequeue, and size management. Tests
 * verify proper FIFO behavior and event emission for queue operations.
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
 * size tracking, and proper event emission for queue activities.
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
   * Test queue enqueue and dequeue operations.
   * 
   * Verifies that items can be added to and removed from the queue
   * in FIFO order with proper event emission.
   */
  it('should enqueue and dequeue items', async () => {
    await queue.enqueue('item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue', {
      item: 'item1',
    });
    await queue.enqueue('item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue', {
      item: 'item2',
    });
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    expect(await queue.dequeue()).toBe('item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue', {
      item: 'item1',
    });
    expect(await queue.dequeue()).toBe('item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue', {
      item: 'item2',
    });
    expect(await queue.size()).toBe(0);
  });

  /**
   * Test queue behavior when empty.
   * 
   * Verifies that dequeuing from an empty queue returns undefined
   * and does not emit dequeue events.
   */
  it('should return undefined when dequeuing from an empty queue', async () => {
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    expect(await queue.dequeue()).toBeUndefined();
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
  it('should return the correct size', async () => {
    expect(await queue.size()).toBe(0);
    await queue.enqueue('item1');
    expect(await queue.size()).toBe(1);
    await queue.enqueue('item2');
    expect(await queue.size()).toBe(2);
    await queue.dequeue();
    expect(await queue.size()).toBe(1);
  });
});
