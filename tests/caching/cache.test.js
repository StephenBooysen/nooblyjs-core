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

  it('should put and get a value', () => {
    cache.put('key', 'value');
    expect(cache.get('key')).toBe('value');
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put', {key: 'key', value: 'value'});
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {key: 'key', value: 'value'});
  });

  it('should delete a value', () => {
    cache.put('key', 'value');
    mockEventEmitter.emit.mockClear(); // Clear previous emits
    cache.delete('key');
    expect(cache.get('key')).toBeUndefined();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:delete', {key: 'key'});
  });

  it('should return undefined for a non-existent key', () => {
    expect(cache.get('non-existent-key')).toBeUndefined();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:get', {key: 'non-existent-key', value: undefined});
  });
});
