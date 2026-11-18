/**
 * @fileoverview Unit tests for the logging script library client.
 *
 * This test suite covers the client-side JavaScript library for consuming
 * the logging service API. Tests verify proper API call construction,
 * log level filtering, error handling, and parameter validation.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const nooblyjslogging = require('../../../src/logging/scripts/client.js');

/**
 * Test suite for the logging script library client.
 *
 * Tests the client library functionality including initialization,
 * API request construction, log levels, error handling, and method validation.
 */
describe('Logging Script Library Client', () => {
  /** @type {nooblyjslogging} Client instance for testing */
  let logger;

  /**
   * Set up test environment before each test case.
   * Creates a fresh logger instance with default settings.
   */
  beforeEach(() => {
    logger = new nooblyjslogging('default');

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
    expect(logger.instanceName).toBe('default');
    expect(logger.baseUrl).toBe('/services/logging/api');
  });

  /**
   * Test initialization with custom instance name.
   */
  it('should initialize with custom instance name', () => {
    const customLogger = new nooblyjslogging('custom-instance');
    expect(customLogger.instanceName).toBe('custom-instance');
    expect(customLogger.baseUrl).toBe('/services/logging/api/custom-instance');
  });

  /**
   * Test initialization with options.
   */
  it('should initialize with options', () => {
    const options = {
      apiKey: 'test-key',
      debug: true,
      minLogLevel: 'debug'
    };
    const customLogger = new nooblyjslogging('default', options);
    expect(customLogger.options.apiKey).toBe('test-key');
    expect(customLogger.options.debug).toBe(true);
    expect(customLogger.options.minLogLevel).toBe('debug');
  });

  /**
   * Test that constructor throws error for non-string instance name.
   */
  it('should throw error if instanceName is not a string', () => {
    expect(() => {
      new nooblyjslogging(123);
    }).toThrow(TypeError);
  });

  /**
   * Test info logging method.
   */
  it('should call info endpoint with correct parameters', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const meta = { userId: 123, action: 'login' };
    await logger.info('User logged in', meta);

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/info',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ message: 'User logged in', meta: meta })
      })
    );
  });

  /**
   * Test warn logging method.
   */
  it('should call warn endpoint with correct parameters', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const meta = { activity: 'multiple_login_attempts' };
    await logger.warn('Unusual activity detected', meta);

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/warn',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Unusual activity detected', meta: meta })
      })
    );
  });

  /**
   * Test error logging method.
   */
  it('should call error endpoint with correct parameters', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const meta = { error: 'timeout', duration: 5000 };
    await logger.error('Database connection failed', meta);

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/error',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Database connection failed', meta: meta })
      })
    );
  });

  /**
   * Test debug logging method.
   */
  it('should call debug endpoint with correct parameters', async () => {
    const debugLogger = new nooblyjslogging('default', { minLogLevel: 'debug' });
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const meta = { requestId: 'abc123', params: { foo: 'bar' } };
    await debugLogger.debug('Processing request', meta);

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/log',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Processing request', meta: meta })
      })
    );
  });

  /**
   * Test that info throws error when message is missing.
   */
  it('should throw error when info message is missing', async () => {
    await expect(logger.info(null))
      .rejects
      .toThrow('Message is required');
  });

  /**
   * Test that warn throws error when message is missing.
   */
  it('should throw error when warn message is missing', async () => {
    await expect(logger.warn(null))
      .rejects
      .toThrow('Message is required');
  });

  /**
   * Test that error throws error when message is missing.
   */
  it('should throw error when error message is missing', async () => {
    await expect(logger.error(null))
      .rejects
      .toThrow('Message is required');
  });

  /**
   * Test that debug throws error when message is missing.
   */
  it('should throw error when debug message is missing', async () => {
    await expect(logger.debug(null))
      .rejects
      .toThrow('Message is required');
  });

  /**
   * Test log level filtering - info level should skip debug
   */
  it('should not log debug messages when log level is info', async () => {
    const infoLogger = new nooblyjslogging('default', { minLogLevel: 'info' });
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await infoLogger.debug('This is debug');

    // fetch should not have been called for debug when minLogLevel is info
    expect(global.fetch).not.toHaveBeenCalled();
  });

  /**
   * Test log level filtering - warn level should skip debug and info
   */
  it('should not log info messages when log level is warn', async () => {
    const warnLogger = new nooblyjslogging('default', { minLogLevel: 'warn' });
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await warnLogger.info('This is info');

    // fetch should not have been called
    expect(global.fetch).not.toHaveBeenCalled();
  });

  /**
   * Test log level filtering - error level should only log errors
   */
  it('should only log errors when log level is error', async () => {
    const errorLogger = new nooblyjslogging('default', { minLogLevel: 'error' });
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await errorLogger.error('This is error');

    expect(global.fetch).toHaveBeenCalled();
  });

  /**
   * Test getAnalytics method.
   */
  it('should call getAnalytics endpoint', async () => {
    const mockAnalytics = { totalLogs: 100, infoCount: 50 };
    const mockResponse = new Response(JSON.stringify(mockAnalytics), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await logger.getAnalytics();

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/analytics',
      expect.objectContaining({
        method: 'GET'
      })
    );
    expect(result).toEqual(mockAnalytics);
  });

  /**
   * Test getSettings method.
   */
  it('should call getSettings endpoint', async () => {
    const mockSettings = { minLogLevel: 'info' };
    const mockResponse = new Response(JSON.stringify(mockSettings), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
    global.fetch.mockResolvedValueOnce(mockResponse);

    const result = await logger.getSettings();

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/settings',
      expect.objectContaining({
        method: 'GET'
      })
    );
    expect(result).toEqual(mockSettings);
  });

  /**
   * Test saveSettings method.
   */
  it('should call saveSettings endpoint with settings object', async () => {
    const settings = { minLogLevel: 'warn' };
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await logger.saveSettings(settings);

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/settings',
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
    await expect(logger.saveSettings(null))
      .rejects
      .toThrow('Settings must be a non-null object');
  });

  /**
   * Test API error handling.
   */
  it('should handle API errors properly', async () => {
    const mockResponse = new Response('Internal Server Error', { status: 500 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    // Info should not throw, but still store locally
    await logger.info('Test message');

    // The log should still be stored locally even if API fails
    const localLogs = logger.getLocalLogs();
    expect(localLogs.length).toBeGreaterThan(0);
  });

  /**
   * Test API key is included in headers when provided.
   */
  it('should include API key in request headers when provided', async () => {
    const apiKeyLogger = new nooblyjslogging('default', { apiKey: 'secret-key' });
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await apiKeyLogger.info('Test message');

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
   * Test request with custom instance name.
   */
  it('should use correct base URL for custom instance', async () => {
    const customLogger = new nooblyjslogging('custom-logger');
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await customLogger.info('Test message');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/services/logging/api/custom-logger/info'),
      expect.any(Object)
    );
  });

  /**
   * Test local log storage.
   */
  it('should store logs locally', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await logger.info('Test info');
    await logger.warn('Test warn');
    await logger.error('Test error');

    const localLogs = logger.getLocalLogs();
    expect(localLogs.length).toBeGreaterThanOrEqual(3);
    expect(localLogs.some(log => log.level === 'info')).toBe(true);
    expect(localLogs.some(log => log.level === 'warn')).toBe(true);
    expect(localLogs.some(log => log.level === 'error')).toBe(true);
  });

  /**
   * Test clearing local logs.
   */
  it('should clear local logs', async () => {
    await logger.info('Test message');
    expect(logger.getLocalLogs().length).toBeGreaterThan(0);

    logger.clearLocalLogs();
    expect(logger.getLocalLogs().length).toBe(0);
  });

  /**
   * Test get/set log level.
   */
  it('should get and set log level', () => {
    expect(logger.getLogLevel()).toBe('info');

    logger.setLogLevel('warn');
    expect(logger.getLogLevel()).toBe('warn');

    logger.setLogLevel('debug');
    expect(logger.getLogLevel()).toBe('debug');
  });

  /**
   * Test setLogLevel throws error for invalid level.
   */
  it('should throw error for invalid log level', () => {
    expect(() => {
      logger.setLogLevel('invalid');
    }).toThrow('Invalid log level');
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

    const result = await logger.getAnalytics();

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

    const result = await logger.info('Test message');

    // Should complete without error
    expect(result).toBeDefined();
  });

  /**
   * Test logging without metadata.
   */
  it('should log messages without metadata', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch.mockResolvedValueOnce(mockResponse);

    await logger.info('Simple message');

    expect(global.fetch).toHaveBeenCalledWith(
      '/services/logging/api/info',
      expect.objectContaining({
        body: JSON.stringify({ message: 'Simple message', meta: undefined })
      })
    );
  });

  /**
   * Test local log limit.
   */
  it('should limit local logs to maxLocalLogs', () => {
    logger.maxLocalLogs = 5;

    // Add more logs than the limit
    for (let i = 0; i < 10; i++) {
      logger.storeLocalLog('info', `Message ${i}`, {});
    }

    const localLogs = logger.getLocalLogs(100);
    expect(localLogs.length).toBeLessThanOrEqual(5);
  });
});
