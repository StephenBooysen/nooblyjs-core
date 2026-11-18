/**
 * @fileoverview Unit tests for the queueing script library client.
 *
 * This test suite covers the client-side JavaScript library for consuming
 * the queueing service API. Tests verify proper API call construction,
 * error handling, and parameter validation.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const nooblyjsqueueing = require('../../../src/queueing/scripts/client.js');

/**
 * Test suite for the queueing script library client.
 *
 * Tests the client library functionality including initialization,
 * API request construction, error handling, and method validation.
 */
describe('Queueing Script Library Client', () => {
  /** @type {nooblyjsqueueing} Client instance for testing */
  let client;

  /**
   * Set up test environment before each test case.
   * Creates a fresh client instance with default settings.s
   */
  beforeEach(() => {
    client = new nooblyjsqueueing('default');

    // Mock the global fetch function
    global.fetch = jest.fn();
  });

  /**
   * Clean up after each test case.
   */
  afterEach(() => {
    jest.clearAllMocks();
    delete global.fetch;
  });

  /**
   * Test initialization with default instance name.
   */
  it('should initialize with default instance name', () => {
    expect(client.instanceName).toBe('default');
    expect(client.baseUrl).toBe('/services/queueing/api');
  });

  /**
   * Test initialization with custom instance name.
   */
  it('should initialize with custom instance name', () => {
    const customClient = new nooblyjsqueueing('custom-instance');
    expect(customClient.instanceName).toBe('custom-instance');
    expect(customClient.baseUrl).toBe('/services/queueing/api/custom-instance');
  });

  /**
   * Test initialization with options.
   */
  it('should initialize with options', () => {
    const options = {
      apiKey: 'test-key',
      debug: true
    };
    const customClient = new nooblyjsqueueing('default', options);
    expect(customClient.options.apiKey).toBe('test-key');
    expect(customClient.options.debug).toBe(true);
  });

  /**
   * Test that constructor throws error for non-string instance name.
   */
  it('should throw error if instanceName is not a string', () => {
    expect(() => {
      new nooblyjsqueueing(123);
    }).toThrow(TypeError);
  });

  /**
   * Test enqueue method with valid parameters.
   */
  it('should call enqueue endpoint with correct parameters', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const task = { userId: 123, action: 'process' };
    await client.enqueue('tasks', task);

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/enqueue/tasks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ task: task })
      })
    );
  });

  /**
   * Test enqueue throws error when queue name is missing.
   */
  it('should throw error when enqueue queue name is missing', async () => {
    await expect(client.enqueue(null, { data: 'test' }))
      .rejects
      .toThrow('Queue name is required');
  });

  /**
   * Test enqueue throws error when task is undefined.
   */
  it('should throw error when enqueue task is undefined', async () => {
    await expect(client.enqueue('tasks', undefined))
      .rejects
      .toThrow('Object to be queued is required');
  });

  /**
   * Test dequeue method calls correct endpoint.
   */
  it('should call dequeue endpoint with correct parameters', async () => {
    const mockTask = { userId: 123, action: 'process' };
    const mockResponse = new Response(JSON.stringify(mockTask), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await client.dequeue('tasks');

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/dequeue/tasks',
      expect.objectContaining({
        method: 'GET'
      })
    );
    expect(result).toEqual(mockTask);
  });

  /**
   * Test dequeue throws error when queue name is missing.
   */
  it('should throw error when dequeue queue name is missing', async () => {
    await expect(client.dequeue(null))
      .rejects
      .toThrow('Queue name is required');
  });

  /**
   * Test size method calls correct endpoint.
   */
  it('should call size endpoint with correct parameters', async () => {
    const mockResponse = new Response('5', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await client.size('tasks');

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/size/tasks',
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  /**
   * Test size throws error when queue name is missing.
   */
  it('should throw error when size queue name is missing', async () => {
    await expect(client.size(null))
      .rejects
      .toThrow('Queue name is required');
  });

  /**
   * Test listQueues method calls correct endpoint.
   */
  it('should call listQueues endpoint', async () => {
    const mockQueues = ['tasks', 'emails', 'notifications'];
    const mockResponse = new Response(JSON.stringify(mockQueues), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await client.listQueues();

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/queues',
      expect.objectContaining({
        method: 'GET'
      })
    );
    expect(result).toEqual(mockQueues);
  });

  /**
   * Test purge method calls correct endpoint.
   */
  it('should call purge endpoint with correct parameters', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await client.purge('tasks');

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/purge/tasks',
      expect.objectContaining({
        method: 'DELETE'
      })
    );
  });

  /**
   * Test purge throws error when queue name is missing.
   */
  it('should throw error when purge queue name is missing', async () => {
    await expect(client.purge(null))
      .rejects
      .toThrow('Queue name is required');
  });

  /**
   * Test getAnalytics method calls correct endpoint.
   */
  it('should call getAnalytics endpoint', async () => {
    const mockAnalytics = { totalEnqueued: 100, totalDequeued: 80 };
    const mockResponse = new Response(JSON.stringify(mockAnalytics), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await client.getAnalytics();

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/analytics',
      expect.objectContaining({
        method: 'GET'
      })
    );
    expect(result).toEqual(mockAnalytics);
  });

  /**
   * Test getSettings method calls correct endpoint.
   */
  it('should call getSettings endpoint', async () => {
    const mockSettings = { maxSize: 1000 };
    const mockResponse = new Response(JSON.stringify(mockSettings), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await client.getSettings();

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/settings',
      expect.objectContaining({
        method: 'GET'
      })
    );
    expect(result).toEqual(mockSettings);
  });

  /**
   * Test saveSettings method calls correct endpoint.
   */
  it('should call saveSettings endpoint with settings object', async () => {
    const settings = { maxSize: 1000 };
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await client.saveSettings(settings);

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/queueing/api/settings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(settings)
      })
    );
  });

  /**
   * Test saveSettings throws error when settings is null.
   */
  it('should throw error when saveSettings settings is null', async () => {
    await expect(client.saveSettings(null))
      .rejects
      .toThrow('Settings must be a non-null object');
  });

  /**
   * Test API error handling.
   */
  it('should handle API errors properly', async () => {
    const mockResponse = new Response('Internal Server Error', { status: 500 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await expect(client.enqueue('tasks', { data: 'test' }))
      .rejects
      .toThrow('API Error (500)');
  });

  /**
   * Test API key is included in headers when provided.
   */
  it('should include API key in request headers when provided', async () => {
    const apiKeyClient = new nooblyjsqueueing('default', { apiKey: 'secret-key' });
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await apiKeyClient.enqueue('tasks', { data: 'test' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-API-Key': 'secret-key'
        })
      })
    );
  });

  /**
   * Test URL encoding of queue names with special characters.
   */
  it('should properly encode queue names with special characters', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await client.enqueue('my-queue/special', { data: 'test' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('enqueue/my-queue%2Fspecial'),
      expect.any(Object)
    );
  });

  /**
   * Test request with custom instance name.
   */
  it('should use correct base URL for custom instance', async () => {
    const customClient = new nooblyjsqueueing('custom-queue');
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await customClient.enqueue('tasks', { data: 'test' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/services/queueing/api/custom-queue/enqueue'),
      expect.any(Object)
    );
  });

  /**
   * Test response type detection (JSON vs text).
   */
  it('should parse JSON responses correctly', async () => {
    const jsonData = { result: 'success' };
    const mockResponse = new Response(JSON.stringify(jsonData), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await client.getAnalytics();

    expect(result).toEqual(jsonData);
  });

  /**
   * Test response type detection for plain text.
   */
  it('should handle plain text responses', async () => {
    const mockResponse = new Response('OK', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await client.enqueue('tasks', { data: 'test' });

    expect(result).toBe('OK');
  });
});
