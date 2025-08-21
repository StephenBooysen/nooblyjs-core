/**
 * @fileoverview Unit tests for the in-memory cache functionality.
 * 
 * This test suite covers the core caching operations including put, get, and delete
 * operations for the in-memory cache provider. Tests verify proper event emission
 * and cache behavior under various scenarios.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createCache = require('../../../src/caching');
const EventEmitter = require('events');

/**
 * Test suite for in-memory cache operations.
 * 
 * Tests the basic CRUD operations (Create, Read, Update, Delete) for the cache
 * and verifies that appropriate events are emitted for each operation.
 */
describe('Cache', () => {
  /** @type {Object} Cache instance for testing */
  let cache;
  /** @type {EventEmitter} Mock event emitter for testing cache events */
  let mockEventEmitter;

  /**
   * Set up test environment before each test case.
   * Creates a fresh cache instance and event emitter spy.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    cache = createCache('memory', {}, mockEventEmitter);
  });

  /**
   * Test cache put and get operations.
   * 
   * Verifies that values can be stored and retrieved from the cache,
   * and that proper events are emitted for both operations.
   */
  it('should put and get a value', async () => {
    await cache.put('key', 'value');
    await expect(cache.get('key')).resolves.toBe('value');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put', {
      key: 'key',
      value: 'value',
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'key',
      value: 'value',
    });
  });

  /**
   * Test cache delete operation.
   * 
   * Verifies that values can be removed from the cache and that
   * the cache:delete event is properly emitted.
   */
  it('should delete a value', async () => {
    await cache.put('key', 'value');
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    await cache.delete('key');
    await expect(cache.get('key')).resolves.toBeUndefined();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:delete', {
      key: 'key',
    });
  });

  /**
   * Test cache behavior for non-existent keys.
   * 
   * Verifies that getting a non-existent key returns undefined
   * and that the cache:get event is still emitted.
   */
  it('should return undefined for a non-existent key', async () => {
    await expect(cache.get('non-existent-key')).resolves.toBeUndefined();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'non-existent-key',
      value: undefined,
    });
  });
});
