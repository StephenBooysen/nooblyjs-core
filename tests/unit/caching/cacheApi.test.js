/**
 * @fileoverview Unit tests for the API-based cache functionality.
 *
 * This test suite covers the API cache provider that connects to remote backend services.
 * Tests verify HTTP requests, API key authentication, and proper error handling.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.14
 */

'use strict';

const createCache = require('../../../src/caching');
const EventEmitter = require('events');
const nock = require('nock');

/**
 * Test suite for API cache operations.
 *
 * Tests the cache operations that communicate with a remote backend API.
 */
describe('Cache API Provider', () => {
  /** @type {Object} Cache instance for testing */
  let cache;
  /** @type {EventEmitter} Mock event emitter for testing cache events */
  let mockEventEmitter;
  /** @type {string} Mock API root URL */
  const apiRoot = 'https://nooblyjs-core-latest.onrender.com';
  /** @type {string} Mock API key */
  const apiKey = 'test-api-key-12345';

  /**
   * Set up test environment before each test case.
   * Creates a fresh cache instance with API provider.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    cache = createCache('api', {
      api: apiRoot,
      apiKey,
      timeout: 5000
    }, mockEventEmitter);
  });

  /**
   * Clean up after each test.
   */
  afterEach(() => {
    nock.cleanAll();
  });

  /**
   * Test cache put operation via API.
   */
  it('should put a value via API', async () => {
    nock(apiRoot)
      .post('/services/caching/api/put/testkey', 'testvalue')
      .matchHeader('X-API-Key', apiKey)
      .reply(200, 'OK');

    await cache.put('testkey', 'testvalue');

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put:default', {
      key: 'testkey',
      value: 'testvalue',
      instance: 'default',
    });
  });

  /**
   * Test cache get operation via API.
   */
  it('should get a value via API', async () => {
    const expectedValue = { data: 'test data' };

    nock(apiRoot)
      .get('/services/caching/api/get/testkey')
      .matchHeader('X-API-Key', apiKey)
      .reply(200, expectedValue);

    const result = await cache.get('testkey');

    expect(result).toEqual(expectedValue);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get:default', {
      key: 'testkey',
      value: expectedValue,
      instance: 'default',
    });
  });

  /**
   * Test cache delete operation via API.
   */
  it('should delete a value via API', async () => {
    nock(apiRoot)
      .delete('/services/caching/api/delete/testkey')
      .matchHeader('X-API-Key', apiKey)
      .reply(200, 'OK');

    await cache.delete('testkey');

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:delete:default', {
      key: 'testkey',
      instance: 'default',
    });
  });

  /**
   * Test cache analytics retrieval via API.
   */
  it('should get analytics via API', async () => {
    const analyticsData = [
      { key: 'key1', hits: 5, lastHit: '2025-10-06T10:00:00Z' },
      { key: 'key2', hits: 10, lastHit: '2025-10-06T11:00:00Z' }
    ];

    nock(apiRoot)
      .get('/services/caching/api/list')
      .matchHeader('X-API-Key', apiKey)
      .reply(200, { success: true, data: analyticsData });

    const result = await cache.getAnalytics();

    expect(result).toEqual(analyticsData);
  });

  /**
   * Test error handling for API failures.
   */
  it('should handle API errors properly', async () => {
    nock(apiRoot)
      .get('/services/caching/api/get/failkey')
      .matchHeader('X-API-Key', apiKey)
      .reply(500, 'Internal Server Error');

    await expect(cache.get('failkey')).rejects.toThrow();

    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:error',
      expect.objectContaining({
        operation: 'get',
        key: 'failkey'
      })
    );
  });

  /**
   * Test API key is properly sent in headers.
   */
  it('should include API key in request headers', async () => {
    const scope = nock(apiRoot)
      .matchHeader('X-API-Key', apiKey)
      .get('/services/caching/api/get/test')
      .reply(200, 'value');

    await cache.get('test');

    expect(scope.isDone()).toBe(true);
  });

  /**
   * Test URL encoding for special characters in keys.
   */
  it('should properly encode keys with special characters', async () => {
    const specialKey = 'user:123/profile';
    const encodedKey = encodeURIComponent(specialKey);

    nock(apiRoot)
      .get(`/services/caching/api/get/${encodedKey}`)
      .reply(200, 'value');

    await cache.get(specialKey);
  });
});
