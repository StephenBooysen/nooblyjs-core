/**
 * @fileoverview Unit tests for the Redis-backed queue functionality.
 *
 * This test suite covers the Redis queue provider, testing queue
 * operations including enqueue, dequeue, and size management with support
 * for multiple named queues using Redis data structures.
 * Tests verify proper FIFO behavior and event emission for queue operations.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// NOTE: this project's Jest config sets "transform": {} which DISABLES
// babel-jest — so jest.mock() calls are NOT hoisted above imports. The mock
// must therefore be registered *before* requiring any module that pulls in
// ioredis, otherwise the provider captures the real client at load time.
let mockRedisClient;
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisClient);
});

const QueueingRedis = require('../../../src/queueing/providers/queueingRedis');
const createQueue = require('../../../src/queueing');
const EventEmitter = require('events');

/**
 * Test suite for Redis-backed queue operations.
 *
 * Tests the Redis queue functionality including FIFO operations,
 * size tracking, multiple named queues, and proper event emission for queue activities.
 */
describe('RedisQueue', () => {
  /** @type {Object} Queue instance for testing */
  let queue;
  /** @type {EventEmitter} Mock event emitter for testing queue events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh Redis queue instance with mocked Redis client.
   */
  beforeEach(() => {
    const createMockClient = () => ({
      status: 'ready',
      connect: jest.fn().mockResolvedValue(undefined),
      lpush: jest.fn().mockResolvedValue(1),
      rpop: jest.fn().mockResolvedValue(null),
      llen: jest.fn().mockResolvedValue(0),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
      quit: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      options: {
        poolSize: 10,
        host: '127.0.0.1',
        port: 6379
      }
    });

    mockRedisClient = createMockClient();

    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    queue = new QueueingRedis({}, mockEventEmitter);
  });

  /**
   * Test queue enqueue and dequeue operations with named queues.
   *
   * Verifies that items can be added to and removed from a named queue
   * in FIFO order with proper event emission.
   */
  it.skip('should enqueue and dequeue items from a named queue', async () => {
    // Reset and setup mocks for this specific test
    mockRedisClient.lpush.mockClear();
    mockRedisClient.rpop.mockClear();
    mockRedisClient.llen.mockClear();

    // Setup mocks for enqueue and dequeue
    mockRedisClient.lpush.mockResolvedValueOnce(1);
    mockRedisClient.lpush.mockResolvedValueOnce(2);
    mockRedisClient.rpop.mockResolvedValueOnce(JSON.stringify('item1'));
    mockRedisClient.rpop.mockResolvedValueOnce(JSON.stringify('item2'));
    mockRedisClient.llen.mockResolvedValueOnce(2);
    mockRedisClient.llen.mockResolvedValueOnce(1);
    mockRedisClient.llen.mockResolvedValueOnce(0);

    // Enqueue items
    await queue.enqueue('emailQueue', 'item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue:default', {
      queueName: 'emailQueue',
      item: 'item1'
    });

    await queue.enqueue('emailQueue', 'item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue:default', {
      queueName: 'emailQueue',
      item: 'item2'
    });

    mockEventEmitter.emit.mockClear();

    // Dequeue items
    const item1 = await queue.dequeue('emailQueue');
    expect(item1).toBe('item1');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue:default', {
      queueName: 'emailQueue',
      item: 'item1'
    });

    const item2 = await queue.dequeue('emailQueue');
    expect(item2).toBe('item2');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue:default', {
      queueName: 'emailQueue',
      item: 'item2'
    });

    const size = await queue.size('emailQueue');
    expect(size).toBe(0);
  });

  /**
   * Test multiple independent queues.
   *
   * Verifies that different named queues operate independently
   * and maintain their own separate items.
   */
  it('should support multiple independent queues', async () => {
    // Create fresh queue for this test
    const freshQueue = createQueue('memory', {}, mockEventEmitter);

    // Enqueue to different queues
    await freshQueue.enqueue('emailQueue', 'email1');
    await freshQueue.enqueue('emailQueue', 'email2');
    await freshQueue.enqueue('imageQueue', 'image1');
    await freshQueue.enqueue('imageQueue', 'image2');
    await freshQueue.enqueue('imageQueue', 'image3');

    expect(await freshQueue.size('emailQueue')).toBe(2);
    expect(await freshQueue.size('imageQueue')).toBe(3);

    await freshQueue.dequeue('emailQueue');
    expect(await freshQueue.size('emailQueue')).toBe(1);
    expect(await freshQueue.size('imageQueue')).toBe(3);

    await freshQueue.dequeue('imageQueue');
    expect(await freshQueue.size('imageQueue')).toBe(2);
  });

  /**
   * Test queue behavior when empty.
   *
   * Verifies that dequeuing from an empty queue returns undefined
   * and does not emit dequeue events.
   */
  it('should return undefined when dequeuing from an empty queue', async () => {
    mockRedisClient.rpop.mockResolvedValueOnce(null);
    mockEventEmitter.emit.mockClear();

    const result = await queue.dequeue('emptyQueue');
    expect(result).toBeUndefined();
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      'queue:dequeue:default',
      expect.any(Object)
    );
  });

  /**
   * Test queue size tracking.
   *
   * Verifies that the queue correctly tracks its size as items
   * are enqueued and dequeued.
   */
  it('should return the correct size for a named queue', async () => {
    mockRedisClient.llen
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    mockRedisClient.lpush.mockResolvedValue(1);

    expect(await queue.size('testQueue')).toBe(0);
    await queue.enqueue('testQueue', 'item1');
    expect(await queue.size('testQueue')).toBe(1);
    await queue.enqueue('testQueue', 'item2');
    expect(await queue.size('testQueue')).toBe(2);

    mockRedisClient.rpop.mockResolvedValueOnce(JSON.stringify('item1'));
    await queue.dequeue('testQueue');
    expect(await queue.size('testQueue')).toBe(1);
  });

  /**
   * Test listing all queue names.
   *
   * Verifies that the listQueues method returns all created queue names.
   */
  it('should list all queue names', async () => {
    // Reset mocks for this test
    mockRedisClient.keys.mockClear();
    mockRedisClient.keys.mockResolvedValueOnce([
      'emailQueue',
      'imageQueue'
    ]);

    const queues = await queue.listQueues();
    expect(Array.isArray(queues)).toBe(true);
    expect(queues).toContain('emailQueue');
    expect(queues).toContain('imageQueue');
  });

  /**
   * Test purging a queue.
   *
   * Verifies that the purge method removes all items from a queue
   * and emits the appropriate event.
   */
  it('should purge a queue', async () => {
    mockRedisClient.del.mockResolvedValueOnce(3);
    mockEventEmitter.emit.mockClear();

    await queue.purge('testQueue');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:purge:default', {
      queueName: 'testQueue'
    });
  });

  /**
   * Test enqueue with object data.
   *
   * Verifies that objects can be enqueued and are properly serialized.
   */
  it('should enqueue and dequeue complex objects', async () => {
    const complexObject = { id: 1, name: 'test', data: { nested: 'value' } };
    mockRedisClient.lpush.mockResolvedValueOnce(1);
    mockRedisClient.rpop.mockResolvedValueOnce(JSON.stringify(complexObject));

    await queue.enqueue('objectQueue', complexObject);
    const result = await queue.dequeue('objectQueue');

    expect(result).toEqual(complexObject);
  });

  /**
   * Test Redis connection handling.
   *
   * Verifies that the queue properly manages Redis connections.
   */
  it('should handle Redis connection', async () => {
    const localQueue = new QueueingRedis({}, mockEventEmitter);
    localQueue.client_.status = 'connecting';
    localQueue.client_.connect = jest.fn().mockResolvedValue(undefined);

    await localQueue.ensureConnection_();

    expect(localQueue.client_.connect).toHaveBeenCalled();
  });

  /**
   * Test that Redis errors are properly thrown.
   *
   * Verifies that when Redis operations fail, errors are propagated.
   */
  it('should throw error when enqueue fails', async () => {
    const failQueue = new QueueingRedis({}, mockEventEmitter);
    const mockClient = {
      status: 'ready',
      connect: jest.fn(),
      lpush: jest.fn().mockRejectedValueOnce(new Error('Redis connection failed')),
      on: jest.fn()
    };
    failQueue.client_ = mockClient;

    await expect(failQueue.enqueue('failQueue', 'item')).rejects.toThrow(
      'Failed to enqueue item to queue "failQueue"'
    );
  });

  /**
   * Test that Redis errors are properly thrown for dequeue.
   */
  it('should throw error when dequeue fails', async () => {
    const failQueue = new QueueingRedis({}, mockEventEmitter);
    const mockClient = {
      status: 'ready',
      connect: jest.fn(),
      rpop: jest.fn().mockRejectedValueOnce(new Error('Redis connection failed')),
      on: jest.fn()
    };
    failQueue.client_ = mockClient;

    await expect(failQueue.dequeue('failQueue')).rejects.toThrow(
      'Failed to dequeue item from queue "failQueue"'
    );
  });

  /**
   * Test settings management.
   *
   * Verifies that queue settings can be retrieved and saved.
   */
  it('should get and save settings', async () => {
    const settings = await queue.getSettings();
    expect(settings).toHaveProperty('redisurl');
    expect(settings).toHaveProperty('redisport');

    await queue.saveSettings({ redisurl: 'redis.example.com', redisport: 6380 });
    expect(queue.settings.redisurl).toBe('redis.example.com');
    expect(queue.settings.redisport).toBe(6380);
  });

  /**
   * Test connection info retrieval.
   */
  it('should return connection info', () => {
    const connInfo = queue.getConnectionInfo();
    expect(connInfo).toHaveProperty('status');
    expect(connInfo).toHaveProperty('poolSize');
    expect(connInfo).toHaveProperty('host');
    expect(connInfo).toHaveProperty('port');
  });

  /**
   * Test analytics tracking.
   */
  it('should track analytics for operations', async () => {
    mockRedisClient.lpush.mockResolvedValue(1);
    mockRedisClient.rpop.mockResolvedValue(JSON.stringify('item'));
    mockRedisClient.llen.mockResolvedValue(0);

    await queue.enqueue('analyticsQueue', 'item1');
    await queue.enqueue('analyticsQueue', 'item2');
    await queue.dequeue('analyticsQueue');

    const analytics = queue.getAnalytics();
    expect(analytics.length).toBeGreaterThan(0);
    expect(analytics[0]).toHaveProperty('queueName');
    expect(analytics[0]).toHaveProperty('operations');
    expect(analytics[0]).toHaveProperty('lastActivity');
  });
});
