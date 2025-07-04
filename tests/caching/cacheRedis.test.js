/**
 * @fileoverview Unit tests for the Redis-backed cache.
 */

const createCache = require('../../src/caching');
const EventEmitter = require('events');
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

describe('CacheRedis', () => {
  let cache;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    cache = createCache(
      'redis',
      { host: '127.0.01', port: 6379 },
      mockEventEmitter,
    );
  });

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
  });

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
  });

  it('should return null for a non-existent key', async () => {
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    const value = await cache.get('non-existent-key');
    expect(value).toBeNull();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'non-existent-key',
      value: null,
    });
  });
});
