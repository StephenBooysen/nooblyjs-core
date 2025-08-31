/**
 * @fileoverview Unit tests for the file-based cache functionality.
 * 
 * This test suite covers the core caching operations including put, get, delete,
 * clear, and stats operations for the file-based cache provider. Tests verify 
 * proper file persistence, event emission, and cache behavior under various scenarios.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createCache = require('../../../src/caching');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Test suite for file-based cache operations.
 * 
 * Tests the basic CRUD operations (Create, Read, Update, Delete) for the file cache,
 * verifies that data persists to disk, and ensures appropriate events are emitted.
 */
describe('CacheFile', () => {
  /** @type {Object} Cache instance for testing */
  let cache;
  /** @type {EventEmitter} Mock event emitter for testing cache events */
  let mockEventEmitter;
  /** @type {string} Temporary cache directory for tests */
  let tempCacheDir;

  /**
   * Set up test environment before each test case.
   * Creates a fresh cache instance, event emitter spy, and temporary cache directory.
   */
  beforeEach(async () => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    
    // Create a unique temporary directory for each test
    tempCacheDir = path.join(os.tmpdir(), `cache-test-${Date.now()}-${Math.random()}`);
    
    cache = createCache('file', { cacheDir: tempCacheDir }, mockEventEmitter);
    
    // Give the cache a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  /**
   * Clean up test environment after each test case.
   * Removes the temporary cache directory and all test files.
   */
  afterEach(async () => {
    try {
      await fs.rm(tempCacheDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  /**
   * Test cache put and get operations with file persistence.
   * 
   * Verifies that values can be stored and retrieved from the cache,
   * that data persists to disk, and that proper events are emitted.
   */
  it('should put and get a value with file persistence', async () => {
    await cache.put('key1', 'value1');
    await expect(cache.get('key1')).resolves.toBe('value1');
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put', {
      key: 'key1',
      value: 'value1',
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'key1',
      value: 'value1',
    });

    // Verify file was created
    const files = await fs.readdir(tempCacheDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    expect(jsonFiles.length).toBe(1);
  });

  /**
   * Test cache with complex data types.
   * 
   * Verifies that objects, arrays, and other JSON-serializable data
   * can be stored and retrieved correctly.
   */
  it('should handle complex data types', async () => {
    const complexValue = {
      string: 'test',
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      nested: { key: 'value' }
    };

    await cache.put('complex', complexValue);
    const retrieved = await cache.get('complex');
    
    expect(retrieved).toEqual(complexValue);
  });

  /**
   * Test cache delete operation with file removal.
   * 
   * Verifies that values can be removed from the cache,
   * that corresponding files are deleted, and that the cache:delete event is emitted.
   */
  it('should delete a value and remove file', async () => {
    await cache.put('deleteKey', 'deleteValue');
    
    // Verify file was created
    let files = await fs.readdir(tempCacheDir);
    expect(files.filter(file => file.endsWith('.json')).length).toBe(1);
    
    mockEventEmitter.emit.mockClear();
    await cache.delete('deleteKey');
    await expect(cache.get('deleteKey')).resolves.toBeUndefined();
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:delete', {
      key: 'deleteKey',
    });

    // Verify file was removed
    files = await fs.readdir(tempCacheDir);
    expect(files.filter(file => file.endsWith('.json')).length).toBe(0);
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

  /**
   * Test cache clear operation.
   * 
   * Verifies that all cached files are removed when clear() is called
   * and that the cache:clear event is emitted.
   */
  it('should clear all cached files', async () => {
    await cache.put('key1', 'value1');
    await cache.put('key2', 'value2');
    await cache.put('key3', 'value3');
    
    // Verify files were created
    let files = await fs.readdir(tempCacheDir);
    expect(files.filter(file => file.endsWith('.json')).length).toBe(3);
    
    mockEventEmitter.emit.mockClear();
    await cache.clear();
    
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:clear');
    
    // Verify all files were removed
    files = await fs.readdir(tempCacheDir);
    expect(files.filter(file => file.endsWith('.json')).length).toBe(0);
    
    // Verify values are no longer accessible
    await expect(cache.get('key1')).resolves.toBeUndefined();
    await expect(cache.get('key2')).resolves.toBeUndefined();
    await expect(cache.get('key3')).resolves.toBeUndefined();
  });

  /**
   * Test cache statistics functionality.
   * 
   * Verifies that getStats() returns accurate file count and total size
   * information for the cache.
   */
  it('should provide accurate cache statistics', async () => {
    let stats = await cache.getStats();
    expect(stats.fileCount).toBe(0);
    expect(stats.totalSize).toBe(0);
    
    await cache.put('stat1', 'value1');
    await cache.put('stat2', 'value2');
    
    stats = await cache.getStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.totalSize).toBeGreaterThan(0);
  });

  /**
   * Test cache analytics functionality.
   * 
   * Verifies that cache operations are tracked properly in analytics
   * and that hit counts are accurate.
   */
  it('should track analytics correctly', async () => {
    await cache.put('analyticsKey', 'analyticsValue');
    await cache.get('analyticsKey');
    await cache.get('analyticsKey');
    
    const analytics = cache.getAnalytics();
    expect(analytics.length).toBe(1);
    expect(analytics[0].key).toBe('analyticsKey');
    expect(analytics[0].hits).toBe(3); // 1 put + 2 gets
    expect(analytics[0].lastHit).toBeDefined();
  });

  /**
   * Test error handling for invalid cache directory.
   * 
   * Verifies that appropriate error events are emitted when
   * file operations fail due to permissions or other issues.
   */
  it('should handle cache directory creation gracefully', async () => {
    // This test verifies the cache can handle directory creation
    const newCache = createCache('file', { 
      cacheDir: path.join(tempCacheDir, 'nested', 'deep', 'directory') 
    }, mockEventEmitter);
    
    await newCache.put('test', 'value');
    await expect(newCache.get('test')).resolves.toBe('value');
  });

  /**
   * Test cache key collision handling.
   * 
   * Verifies that different cache keys with potentially similar hashes
   * are handled correctly and don't interfere with each other.
   */
  it('should handle different keys correctly', async () => {
    await cache.put('key1', 'value1');
    await cache.put('key2', 'value2');
    await cache.put('very-long-key-with-special-chars!@#$%', 'specialValue');
    
    await expect(cache.get('key1')).resolves.toBe('value1');
    await expect(cache.get('key2')).resolves.toBe('value2');
    await expect(cache.get('very-long-key-with-special-chars!@#$%')).resolves.toBe('specialValue');
    
    const stats = await cache.getStats();
    expect(stats.fileCount).toBe(3);
  });

  /**
   * Test cache persistence across instances.
   * 
   * Verifies that data persists when a new cache instance is created
   * pointing to the same cache directory.
   */
  it('should persist data across cache instances', async () => {
    await cache.put('persistKey', 'persistValue');
    
    // Create a new cache instance pointing to the same directory
    const newCache = createCache('file', { cacheDir: tempCacheDir }, mockEventEmitter);
    
    await expect(newCache.get('persistKey')).resolves.toBe('persistValue');
  });

  /**
   * Test deleting non-existent keys.
   * 
   * Verifies that deleting a non-existent key doesn't cause errors
   * and handles the operation gracefully.
   */
  it('should handle deleting non-existent keys gracefully', async () => {
    await expect(cache.delete('non-existent')).resolves.not.toThrow();
    
    // Should not emit cache:delete for non-existent keys
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('cache:delete', {
      key: 'non-existent',
    });
  });
});