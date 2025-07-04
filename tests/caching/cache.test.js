/**
 * @fileoverview Unit tests for the in-memory cache.
 */

const createCache = require('../../src/caching');
const EventEmitter = require('events');

describe('Cache', () => {
  let cache;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    cache = createCache('memory', {}, mockEventEmitter);
  });

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

  it('should delete a value', async () => {
    await cache.put('key', 'value');
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    await cache.delete('key');
    await expect(cache.get('key')).resolves.toBeUndefined();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:delete', {
      key: 'key',
    });
  });

  it('should return undefined for a non-existent key', async () => {
    await expect(cache.get('non-existent-key')).resolves.toBeUndefined();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {
      key: 'non-existent-key',
      value: undefined,
    });
  });
});
