/**
 * @fileoverview Unit tests for the RabbitMQ-backed queue functionality.
 *
 * This test suite covers the RabbitMQ queue provider, testing queue
 * operations including enqueue, dequeue, and size management with support
 * for multiple named queues using RabbitMQ.
 * Tests verify proper FIFO behavior and event emission for queue operations.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const EventEmitter = require('events');

// Mock amqplib BEFORE loading the queue provider
jest.mock('amqplib');

const QueueingRabbitMQ = require('../../../src/queueing/providers/queueingRabbitMQ');
const createQueue = require('../../../src/queueing');

/**
 * Test suite for RabbitMQ-backed queue operations.
 *
 * Tests the RabbitMQ queue functionality including FIFO operations,
 * size tracking, multiple named queues, and proper event emission for queue activities.
 */
describe('RabbitMQQueue', () => {
  /** @type {Object} Queue instance for testing */
  let queue;
  /** @type {EventEmitter} Mock event emitter for testing queue events */
  let mockEventEmitter;
  /** @type {Object} Mocked RabbitMQ channel */
  let mockChannel;
  /** @type {Object} Mocked RabbitMQ connection */
  let mockConnection;

  /**
   * Set up test environment before each test case.
   * Creates a fresh RabbitMQ queue instance with mocked RabbitMQ client.
   */
  beforeEach(() => {
    // Setup mock RabbitMQ channel
    mockChannel = {
      assertQueue: jest.fn().mockResolvedValue({ messageCount: 0 }),
      sendToQueue: jest.fn().mockReturnValue(true),
      get: jest.fn().mockResolvedValue(null),
      purgeQueue: jest.fn().mockResolvedValue({ messageCount: 0 }),
      ack: jest.fn(),
      prefetch: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    };

    // Setup mock RabbitMQ connection
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      once: jest.fn()
    };

    // Mock amqplib
    const amqp = require('amqplib');
    amqp.connect = jest.fn().mockResolvedValue(mockConnection);

    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    queue = new QueueingRabbitMQ({}, mockEventEmitter);
  });

  /**
   * Cleanup after each test.
   */
  afterEach(async () => {
    if (queue) {
      await queue.disconnect();
    }
    jest.clearAllMocks();
  });

  /**
   * Test basic enqueue operation.
   *
   * Verifies that items can be added to a queue.
   */
  it('should enqueue items to a queue', async () => {
    mockChannel.assertQueue.mockResolvedValue({ messageCount: 1 });
    mockChannel.sendToQueue.mockReturnValue(true);

    await queue.enqueue('testQueue', 'item1');

    expect(mockChannel.assertQueue).toHaveBeenCalledWith('testQueue', expect.any(Object));
    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
      'testQueue',
      expect.any(Buffer),
      expect.any(Object)
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:enqueue:default', {
      queueName: 'testQueue',
      item: 'item1'
    });
  });

  /**
   * Test basic dequeue operation.
   *
   * Verifies that items can be removed from a queue.
   */
  it('should dequeue items from a queue', async () => {
    const mockMessage = {
      content: Buffer.from(JSON.stringify('item1'))
    };
    mockChannel.get.mockResolvedValue(mockMessage);

    const item = await queue.dequeue('testQueue');

    expect(item).toBe('item1');
    expect(mockChannel.get).toHaveBeenCalledWith('testQueue', { noAck: false });
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:dequeue:default', {
      queueName: 'testQueue',
      item: 'item1'
    });
  });

  /**
   * Test multiple independent queues.
   *
   * Verifies that different named queues operate independently.
   */
  it('should support multiple independent queues', async () => {
    const freshQueue = createQueue('memory', {}, mockEventEmitter);

    await freshQueue.enqueue('emailQueue', 'email1');
    await freshQueue.enqueue('emailQueue', 'email2');
    await freshQueue.enqueue('imageQueue', 'image1');
    await freshQueue.enqueue('imageQueue', 'image2');

    expect(await freshQueue.size('emailQueue')).toBe(2);
    expect(await freshQueue.size('imageQueue')).toBe(2);

    await freshQueue.dequeue('emailQueue');
    expect(await freshQueue.size('emailQueue')).toBe(1);
  });

  /**
   * Test dequeue from empty queue.
   *
   * Verifies that dequeuing from an empty queue returns undefined.
   * Also verifies that the dequeue event is still emitted for analytics tracking.
   */
  it('should return undefined when dequeuing from an empty queue', async () => {
    mockChannel.get.mockResolvedValue(null);
    mockEventEmitter.emit.mockClear();

    const result = await queue.dequeue('emptyQueue');

    expect(result).toBeUndefined();
    // Event should be emitted even for empty dequeue operations (for analytics tracking)
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'queue:dequeue:default',
      expect.objectContaining({
        queueName: 'emptyQueue',
        item: undefined
      })
    );
  });

  /**
   * Test queue size retrieval.
   *
   * Verifies that queue size can be retrieved correctly.
   */
  it('should return the correct queue size', async () => {
    mockChannel.assertQueue
      .mockResolvedValueOnce({ messageCount: 0 })
      .mockResolvedValueOnce({ messageCount: 2 })
      .mockResolvedValueOnce({ messageCount: 5 });

    const size1 = await queue.size('testQueue');
    const size2 = await queue.size('testQueue');
    const size3 = await queue.size('testQueue');

    expect(size1).toBe(0);
    expect(size2).toBe(2);
    expect(size3).toBe(5);
  });

  /**
   * Test listing queues.
   *
   * Verifies that queue operations are tracked and can be listed.
   */
  it('should list queues from analytics', async () => {
    mockChannel.sendToQueue.mockReturnValue(true);
    mockChannel.assertQueue.mockResolvedValue({ messageCount: 1 });

    await queue.enqueue('queue1', 'item1');
    await queue.enqueue('queue2', 'item2');
    await queue.enqueue('queue3', 'item3');

    const queues = await queue.listQueues();

    expect(queues).toContain('queue1');
    expect(queues).toContain('queue2');
    expect(queues).toContain('queue3');
  });

  /**
   * Test purging a queue.
   *
   * Verifies that all items can be removed from a queue.
   */
  it('should purge a queue', async () => {
    mockChannel.purgeQueue.mockResolvedValue({ messageCount: 10 });
    mockEventEmitter.emit.mockClear();

    await queue.purge('testQueue');

    expect(mockChannel.purgeQueue).toHaveBeenCalledWith('testQueue');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queue:purge:default', {
      queueName: 'testQueue'
    });
  });

  /**
   * Test enqueue with complex objects.
   *
   * Verifies that objects are properly serialized and deserialized.
   */
  it('should enqueue and dequeue complex objects', async () => {
    const complexObject = { id: 1, name: 'test', data: { nested: 'value' } };
    mockChannel.sendToQueue.mockReturnValue(true);
    mockChannel.assertQueue.mockResolvedValue({ messageCount: 1 });

    const mockMessage = {
      content: Buffer.from(JSON.stringify(complexObject))
    };
    mockChannel.get.mockResolvedValue(mockMessage);

    await queue.enqueue('objectQueue', complexObject);
    const result = await queue.dequeue('objectQueue');

    expect(result).toEqual(complexObject);
  });

  /**
   * Test RabbitMQ connection establishment.
   */
  it('should establish RabbitMQ connection', async () => {
    const amqp = require('amqplib');

    await queue.ensureConnection_();

    expect(amqp.connect).toHaveBeenCalledWith('amqp://localhost');
    expect(mockConnection.createChannel).toHaveBeenCalled();
    expect(mockChannel.prefetch).toHaveBeenCalledWith(1);
  });

  /**
   * Test settings management.
   */
  it('should get and save settings', async () => {
    const settings = await queue.getSettings();
    expect(settings).toHaveProperty('rabbitmqUrl');
    expect(settings.rabbitmqUrl).toBe('amqp://localhost');

    await queue.saveSettings({ rabbitmqUrl: 'amqp://example.com' });
    expect(queue.settings.rabbitmqUrl).toBe('amqp://example.com');
  });

  /**
   * Test connection info retrieval.
   */
  it('should return connection info', async () => {
    const connInfo = queue.getConnectionInfo();

    expect(connInfo).toHaveProperty('status');
    expect(connInfo).toHaveProperty('connected');
    expect(connInfo).toHaveProperty('url');
    expect(connInfo.connected).toBe(false); // Not connected until ensureConnection is called
  });

  /**
   * Test analytics tracking.
   */
  it('should track analytics for operations', async () => {
    mockChannel.sendToQueue.mockReturnValue(true);
    mockChannel.assertQueue.mockResolvedValue({ messageCount: 1 });

    await queue.enqueue('analyticsQueue', 'item1');
    await queue.enqueue('analyticsQueue', 'item2');

    const analytics = queue.getAnalytics();

    expect(analytics.length).toBeGreaterThan(0);
    expect(analytics[0]).toHaveProperty('queueName');
    expect(analytics[0]).toHaveProperty('operations');
    expect(analytics[0]).toHaveProperty('lastActivity');
  });

  /**
   * Test enqueue failure handling.
   */
  it('should throw error when enqueue fails', async () => {
    mockChannel.assertQueue.mockRejectedValueOnce(new Error('Queue assertion failed'));

    await expect(queue.enqueue('failQueue', 'item')).rejects.toThrow(
      'Failed to enqueue item to queue "failQueue"'
    );
  });

  /**
   * Test dequeue failure handling.
   */
  it('should throw error when dequeue fails', async () => {
    mockChannel.assertQueue.mockRejectedValueOnce(new Error('Queue assertion failed'));

    await expect(queue.dequeue('failQueue')).rejects.toThrow(
      'Failed to dequeue item from queue "failQueue"'
    );
  });

  /**
   * Test sendToQueue failure handling.
   */
  it('should throw error when message send fails', async () => {
    mockChannel.sendToQueue.mockReturnValue(false); // False means send failed

    await expect(queue.enqueue('failQueue', 'item')).rejects.toThrow(
      'Failed to enqueue item to queue "failQueue"'
    );
  });

  /**
   * Test disconnect functionality.
   */
  it('should disconnect from RabbitMQ', async () => {
    await queue.ensureConnection_();
    await queue.disconnect();

    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConnection.close).toHaveBeenCalled();
    expect(queue.connected_).toBe(false);
  });

  /**
   * Test message persistence.
   *
   * Verifies that messages are sent with persistent flag.
   */
  it('should send messages with persistent flag', async () => {
    mockChannel.sendToQueue.mockReturnValue(true);

    await queue.enqueue('persistQueue', 'item1');

    const callArgs = mockChannel.sendToQueue.mock.calls[0];
    expect(callArgs[2]).toHaveProperty('persistent', true);
  });

  /**
   * Test durable queue assertion.
   *
   * Verifies that queues are declared as durable.
   */
  it('should assert queues as durable', async () => {
    mockChannel.sendToQueue.mockReturnValue(true);

    await queue.enqueue('durableQueue', 'item1');

    const callArgs = mockChannel.assertQueue.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('durable', true);
  });

  /**
   * Test message acknowledgment on dequeue.
   *
   * Verifies that messages are acknowledged after dequeue.
   */
  it('should acknowledge message after dequeue', async () => {
    const mockMessage = {
      content: Buffer.from(JSON.stringify('item1'))
    };
    mockChannel.get.mockResolvedValue(mockMessage);

    await queue.dequeue('ackQueue');

    expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
  });
});
