/**
 * @fileoverview Unit tests for the in-memory queue.
 */

const createQueue = require('../../src/queueing');
const EventEmitter = require('events');

describe('InMemoryQueue', () => {
  let queue;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    queue = createQueue('memory', {}, mockEventEmitter);
  });

  it('should enqueue and dequeue items', () => {
    queue.enqueue('item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue', {item: 'item1'});
    queue.enqueue('item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue', {item: 'item2'});
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    expect(queue.dequeue()).toBe('item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue', {item: 'item1'});
    expect(queue.dequeue()).toBe('item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue', {item: 'item2'});
    expect(queue.size()).toBe(0);
  });

  it('should return undefined when dequeuing from an empty queue', () => {
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    expect(queue.dequeue()).toBeUndefined();
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('queue:dequeue', expect.any(Object));
  });

  it('should return the correct size', () => {
    expect(queue.size()).toBe(0);
    queue.enqueue('item1');
    expect(queue.size()).toBe(1);
    queue.enqueue('item2');
    expect(queue.size()).toBe(2);
    queue.dequeue();
    expect(queue.size()).toBe(1);
  });
});
