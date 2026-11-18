/**
 * @fileoverview Unit tests for the Redis-backed cache functionality.
 * 
 * This test suite covers Redis cache operations including put, get, and delete
 * operations using the Redis cache provider. Tests use ioredis-mock to simulate
 * Redis behavior without requiring an actual Redis instance.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createCache = require('../../../src/caching');
const EventEmitter = require('events');

/**
 * Mock Redis implementation for testing.
 * Uses ioredis-mock to simulate Redis operations without requiring a real Redis instance.
 */
jest.mock('ioredis', () => {
  const RedisMock = jest.requireActual('ioredis-mock');
  return class MockRedis extends RedisMock {
    constructor(options) {
      super(options);
      jest.spyOn(this, 'set');
      jest.spyOn(this, 'get');
      jest.spyOn(this, 'del');
    }
  };
});

/**
 * Test suite for Redis cache operations.
 * 
 * Tests the Redis cache provider functionality including CRUD operations
 * and verifies that appropriate events are emitted for each operation.
 * Uses mocked Redis to avoid external dependencies in tests.
 */
describe('CacheRedis', () => {
  /** @type {Object} Redis cache instance for testing */
  let cache;
  /** @type {EventEmitter} Mock event emitter for testing cache events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh Redis cache instance with mock configuration.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    cache = createCache(
      'redis',
      { host: '127.0.01', port: 6379 },
      mockEventEmitter,
    );
  });

  /**
   * Test Redis cache put and get operations.
   * 
   * Verifies that values can be stored and retrieved from Redis cache,
   * and that proper events are emitted for both operations.
   */
  it('should put and get a value', async () => {
    await cache.put('key', 'value');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put', {
      key: 'key',
      value: 'value',
    });
    mockEventEmitter.emit.mockClear(); // Clear emits before get
    const value = await cache.get('key');
    expect(value).toBe('value');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'key',
      value: 'value',
    });
  }, 10000);

  /**
   * Test Redis cache delete operation.
   * 
   * Verifies that values can be removed from Redis cache and that
   * the cache:delete event is properly emitted. Also tests that
   * deleted keys return null.
   */
  it('should delete a value', async () => {
    await cache.put('key', 'value');
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    await cache.delete('key');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:delete', {
      key: 'key',
    });
    mockEventEmitter.emit.mockClear(); // Clear emits before get
    const value = await cache.get('key');
    expect(value).toBeNull();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'key',
      value: null,
    });
  }, 10000);

  /**
   * Test Redis cache behavior for non-existent keys.
   * 
   * Verifies that getting a non-existent key returns null (Redis behavior)
   * and that the cache:get event is still emitted.
   */
  it('should return null for a non-existent key', async () => {
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    const value = await cache.get('non-existent-key');
    expect(value).toBeNull();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'non-existent-key',
      value: null,
    });
  }, 10000);
});
