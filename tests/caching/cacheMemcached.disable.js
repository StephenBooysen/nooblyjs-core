/**
 * @fileoverview Unit tests for the Memcached-backed cache implementation.
 */

const CacheMemcached = require('../../src/caching/providers/cachingMemcached.js');
const { Client } = require('memjs');
const EventEmitter = require('events');

// Mock the memjs client to avoid actual network calls during tests
const mockSet = jest.fn();
const mockGet = jest.fn();
const mockDelete = jest.fn();
const mockCreate = jest.fn(() => ({
  set: mockSet,
  get: mockGet,
  delete: mockDelete,
}));

jest.mock('memjs', () => ({
  Client: {
    create: mockCreate,
  },
}));

describe('CacheMemcached', () => {
  const mockMemcachedUrl = 'memcached://localhost:11211';
  let cacheMemcached;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    // Clear mocks before each test
    mockSet.mockClear();
    mockGet.mockClear();
    mockDelete.mockClear();
    mockCreate.mockClear();

    cacheMemcached = new CacheMemcached(
      { url: mockMemcachedUrl },
      mockEventEmitter,
    );
  });

  it('should initialize with a valid URL', () => {
    expect(mockCreate).toHaveBeenCalledWith(mockMemcachedUrl);
    expect(cacheMemcached.client_).toEqual(
      require('memjs').Client.create(mockMemcachedUrl),
    );
  });

  it('should throw an error if no URL is provided', () => {
    expect(() => new CacheMemcached({}, mockEventEmitter)).toThrow(
      'Memcached connection URL is required.',
    );
    expect(() => new CacheMemcached(undefined, mockEventEmitter)).toThrow(
      'Memcached connection URL is required.',
    );
  });

  it('should call client.set when put is called with a string value', async () => {
    await cacheMemcached.put('testKey', 'testValue');
    expect(mockSet).toHaveBeenCalledWith('testKey', 'testValue', {
      expires: 0,
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put', {
      key: 'testKey',
      value: 'testValue',
      ttl: undefined,
    });
  });

  it('should call client.set when put is called with an object value', async () => {
    const obj = { a: 1, b: 'hello' };
    await cacheMemcached.put('testObjectKey', obj);
    expect(mockSet).toHaveBeenCalledWith('testObjectKey', JSON.stringify(obj), {
      expires: 0,
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put', {
      key: 'testObjectKey',
      value: obj,
      ttl: undefined,
    });
  });

  it('should call client.set with TTL when put is called with ttl', async () => {
    await cacheMemcached.put('testKeyWithTtl', 'testValue', 60);
    expect(mockSet).toHaveBeenCalledWith('testKeyWithTtl', 'testValue', {
      expires: 60,
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put', {
      key: 'testKeyWithTtl',
      value: 'testValue',
      ttl: 60,
    });
  });

  it('should call client.get and return string value', async () => {
    mockGet.mockResolvedValueOnce({ value: Buffer.from('retrievedValue') });
    const value = await cacheMemcached.get('testKey');
    expect(mockGet).toHaveBeenCalledWith('testKey');
    expect(value).toBe('retrievedValue');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'testKey',
      value: 'retrievedValue',
    });
  });

  it('should call client.get and return parsed object value', async () => {
    const obj = { c: 3, d: 'world' };
    mockGet.mockResolvedValueOnce({ value: Buffer.from(JSON.stringify(obj)) });
    const value = await cacheMemcached.get('testObjectKey');
    expect(mockGet).toHaveBeenCalledWith('testObjectKey');
    expect(value).toEqual(obj);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'testObjectKey',
      value: obj,
    });
  });

  it('should return null if key not found', async () => {
    mockGet.mockResolvedValueOnce({ value: null });
    const value = await cacheMemcached.get('nonExistentKey');
    expect(mockGet).toHaveBeenCalledWith('nonExistentKey');
    expect(value).toBeNull();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'nonExistentKey',
      value: null,
    });
  });

  it('should call client.delete when delete is called', async () => {
    await cacheMemcached.delete('keyToDelete');
    expect(mockDelete).toHaveBeenCalledWith('keyToDelete');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:delete', {
      key: 'keyToDelete',
    });
  });
});
