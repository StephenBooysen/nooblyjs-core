/**
 * @fileoverview Comprehensive feature verification tests for Caching Service
 * Tests all documented features from CACHING-SERVICE-USAGE.md
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const EventEmitter = require('events');
const Cache = require('../../../src/caching/providers/caching');
const CacheAnalytics = require('../../../src/caching/modules/analytics');

describe('Caching Service - Feature Verification', () => {
  let cache;
  let eventEmitter;
  let mockLogger;

  beforeEach(() => {
    eventEmitter = new EventEmitter();
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
    cache = new Cache({ instanceName: 'default' }, eventEmitter);
    cache.logger = mockLogger;
  });

  describe('Core Service API Methods', () => {
    describe('put(key, value) method', () => {
      test('should store a simple value', async () => {
        await cache.put('user:123', { name: 'John', email: 'john@example.com' });
        const value = await cache.get('user:123');
        expect(value).toEqual({ name: 'John', email: 'john@example.com' });
      });

      test('should store array values', async () => {
        const tags = ['nodejs', 'javascript', 'caching'];
        await cache.put('tags:popular', tags);
        const value = await cache.get('tags:popular');
        expect(value).toEqual(tags);
      });

      test('should store nested objects', async () => {
        const config = {
          theme: 'dark',
          language: 'en',
          notifications: {
            email: true,
            push: false
          }
        };
        await cache.put('config:app', config);
        const value = await cache.get('config:app');
        expect(value).toEqual(config);
      });

      test('should emit cache:put event with instance name', async () => {
        const putHandler = jest.fn();
        eventEmitter.on('cache:put:default', putHandler);

        await cache.put('key', 'value');

        expect(putHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'key',
            value: 'value',
            instance: 'default'
          })
        );
      });

      test('should reject undefined value', async () => {
        await expect(cache.put('key', undefined)).rejects.toThrow('cannot be undefined');
      });

      test('should reject empty string key', async () => {
        await expect(cache.put('', 'value')).rejects.toThrow('Invalid key');
      });

      test('should reject non-string key', async () => {
        await expect(cache.put(123, 'value')).rejects.toThrow('Invalid key');
      });

      test('should reject null key', async () => {
        await expect(cache.put(null, 'value')).rejects.toThrow('Invalid key');
      });
    });

    describe('get(key) method', () => {
      beforeEach(async () => {
        await cache.put('user:123', { name: 'John', email: 'john@example.com' });
      });

      test('should retrieve stored value', async () => {
        const value = await cache.get('user:123');
        expect(value).toEqual({ name: 'John', email: 'john@example.com' });
      });

      test('should return undefined for non-existent key', async () => {
        const value = await cache.get('nonexistent');
        expect(value).toBeUndefined();
      });

      test('should emit cache:get event with instance name', async () => {
        const getHandler = jest.fn();
        eventEmitter.on('cache:get:default', getHandler);

        const value = await cache.get('user:123');

        expect(getHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'user:123',
            value: { name: 'John', email: 'john@example.com' },
            instance: 'default'
          })
        );
      });

      test('should reject empty string key', async () => {
        await expect(cache.get('')).rejects.toThrow('Invalid key');
      });

      test('should reject non-string key', async () => {
        await expect(cache.get(123)).rejects.toThrow('Invalid key');
      });
    });

    describe('delete(key) method', () => {
      beforeEach(async () => {
        await cache.put('user:123', { name: 'John' });
      });

      test('should remove stored value', async () => {
        await cache.delete('user:123');
        const value = await cache.get('user:123');
        expect(value).toBeUndefined();
      });

      test('should emit cache:delete event', async () => {
        const deleteHandler = jest.fn();
        eventEmitter.on('cache:delete:default', deleteHandler);

        await cache.delete('user:123');

        expect(deleteHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            key: 'user:123',
            instance: 'default'
          })
        );
      });

      test('should reject empty string key', async () => {
        await expect(cache.delete('')).rejects.toThrow('Invalid key');
      });

      test('should not error when deleting non-existent key', async () => {
        await expect(cache.delete('nonexistent')).resolves.not.toThrow();
      });
    });

    describe('getAnalytics() method', () => {
      beforeEach(async () => {
        await cache.put('user:123', { name: 'John' });
        await cache.get('user:123');
        await cache.get('user:123');
      });

      test('should return analytics array', async () => {
        const analytics = cache.getAnalytics();
        expect(Array.isArray(analytics)).toBe(true);
      });

      test('should track hit counts', async () => {
        const analytics = cache.getAnalytics();
        const userAnalytic = analytics.find(a => a.key === 'user:123');
        expect(userAnalytic).toBeDefined();
        expect(userAnalytic.hits).toBe(3); // 1 put + 2 gets
      });

      test('should include last hit timestamp', async () => {
        const analytics = cache.getAnalytics();
        const userAnalytic = analytics.find(a => a.key === 'user:123');
        expect(userAnalytic.lastHit).toBeDefined();
        expect(new Date(userAnalytic.lastHit)).toBeInstanceOf(Date);
      });
    });

    describe('getSettings() and saveSettings() methods', () => {
      test('should return settings object', async () => {
        const settings = await cache.getSettings();
        expect(settings).toBeDefined();
        expect(typeof settings).toBe('object');
      });

      test('should save settings without error', async () => {
        const newSettings = { testSetting: 'testValue' };
        await expect(cache.saveSettings(newSettings)).resolves.not.toThrow();
      });
    });
  });

  describe('Analytics Module', () => {
    let analytics;

    beforeEach(() => {
      analytics = new CacheAnalytics(eventEmitter, 'default');
    });

    describe('Event Listening', () => {
      test('should track cache:put events', async () => {
        eventEmitter.emit('cache:put:default', {
          key: 'user:123',
          value: { name: 'John' },
          instance: 'default'
        });

        const stats = analytics.getStats();
        expect(stats.totalWrites).toBe(1);
      });

      test('should track cache:get events as hits', async () => {
        eventEmitter.emit('cache:put:default', {
          key: 'user:123',
          value: { name: 'John' }
        });

        eventEmitter.emit('cache:get:default', {
          key: 'user:123',
          value: { name: 'John' }
        });

        const stats = analytics.getStats();
        expect(stats.totalHits).toBe(1);
        expect(stats.totalReads).toBe(1);
      });

      test('should track cache:get events as misses', async () => {
        eventEmitter.emit('cache:get:default', {
          key: 'nonexistent',
          value: undefined
        });

        const stats = analytics.getStats();
        expect(stats.totalMisses).toBe(1);
        expect(stats.totalReads).toBe(1);
      });

      test('should track cache:delete events', async () => {
        eventEmitter.emit('cache:delete:default', {
          key: 'user:123'
        });

        const stats = analytics.getStats();
        expect(stats.totalWrites).toBe(1);
      });
    });

    describe('getStats() method', () => {
      beforeEach(() => {
        eventEmitter.emit('cache:put:default', {
          key: 'key1',
          value: 'value1'
        });
        eventEmitter.emit('cache:get:default', {
          key: 'key1',
          value: 'value1'
        });
        eventEmitter.emit('cache:get:default', {
          key: 'key2',
          value: undefined
        });
      });

      test('should return stats object with all metrics', () => {
        const stats = analytics.getStats();

        expect(stats).toHaveProperty('totalKeys');
        expect(stats).toHaveProperty('totalHits');
        expect(stats).toHaveProperty('totalMisses');
        expect(stats).toHaveProperty('totalReads');
        expect(stats).toHaveProperty('totalWrites');
        expect(stats).toHaveProperty('keys');
      });

      test('should calculate correct totals', () => {
        const stats = analytics.getStats();

        expect(stats.totalKeys).toBe(2);
        expect(stats.totalHits).toBe(1);
        expect(stats.totalMisses).toBe(1);
        expect(stats.totalReads).toBe(2);
        expect(stats.totalWrites).toBe(1);
      });

      test('should track per-key statistics', () => {
        const stats = analytics.getStats();

        expect(stats.keys['key1']).toBeDefined();
        expect(stats.keys['key1'].hitCount).toBe(1);
        expect(stats.keys['key1'].totalReads).toBe(1);
        expect(stats.keys['key1'].putCount).toBe(1);

        expect(stats.keys['key2']).toBeDefined();
        expect(stats.keys['key2'].missCount).toBe(1);
      });
    });

    describe('getKeyStats() method', () => {
      beforeEach(() => {
        eventEmitter.emit('cache:put:default', {
          key: 'user:123',
          value: { name: 'John' }
        });
        eventEmitter.emit('cache:get:default', {
          key: 'user:123',
          value: { name: 'John' }
        });
      });

      test('should return stats for existing key', () => {
        const stats = analytics.getKeyStats('user:123');

        expect(stats).toBeDefined();
        expect(stats.hitCount).toBe(1);
        expect(stats.putCount).toBe(1);
        expect(stats.firstActivity).toBeDefined();
        expect(stats.lastActivity).toBeDefined();
      });

      test('should return null for non-existent key', () => {
        const stats = analytics.getKeyStats('nonexistent');
        expect(stats).toBeNull();
      });
    });

    describe('getTopKeys() method', () => {
      beforeEach(() => {
        for (let i = 1; i <= 10; i++) {
          eventEmitter.emit('cache:put:default', {
            key: `key${i}`,
            value: `value${i}`
          });
          for (let j = 0; j < i; j++) {
            eventEmitter.emit('cache:get:default', {
              key: `key${i}`,
              value: `value${i}`
            });
          }
        }
      });

      test('should return top keys sorted by hits', () => {
        const topKeys = analytics.getTopKeys(5, 'hits');

        expect(topKeys).toHaveLength(5);
        expect(topKeys[0].hitCount).toBeGreaterThanOrEqual(topKeys[1].hitCount);
      });

      test('should respect limit parameter', () => {
        const topKeys3 = analytics.getTopKeys(3, 'hits');
        const topKeys10 = analytics.getTopKeys(10, 'hits');

        expect(topKeys3.length).toBeLessThanOrEqual(3);
        expect(topKeys10.length).toBeLessThanOrEqual(10);
      });

      test('should sort by activity metric', () => {
        const topActivity = analytics.getTopKeys(5, 'activity');

        expect(topActivity).toHaveLength(5);
        const activities = topActivity.map(k => k.totalActivity);
        expect(activities).toEqual([...activities].sort((a, b) => b - a));
      });

      test('should sort by reads metric', () => {
        const topReads = analytics.getTopKeys(5, 'reads');

        expect(topReads).toHaveLength(5);
        const reads = topReads.map(k => k.totalReads);
        expect(reads).toEqual([...reads].sort((a, b) => b - a));
      });

      test('should sort by writes metric', () => {
        const topWrites = analytics.getTopKeys(5, 'writes');

        expect(topWrites).toHaveLength(5);
        const writes = topWrites.map(k => k.totalWrites);
        expect(writes).toEqual([...writes].sort((a, b) => b - a));
      });
    });

    describe('getTopMisses() method', () => {
      beforeEach(() => {
        for (let i = 1; i <= 5; i++) {
          for (let j = 0; j < i; j++) {
            eventEmitter.emit('cache:get:default', {
              key: `missed:${i}`,
              value: undefined
            });
          }
        }
      });

      test('should return keys with highest miss counts', () => {
        const topMisses = analytics.getTopMisses(5);

        expect(topMisses).toHaveLength(5);
        expect(topMisses[0].missCount).toBeGreaterThanOrEqual(topMisses[1].missCount);
      });

      test('should include miss count in response', () => {
        const topMisses = analytics.getTopMisses(5);

        topMisses.forEach(miss => {
          expect(miss).toHaveProperty('key');
          expect(miss).toHaveProperty('missCount');
          expect(miss).toHaveProperty('stats');
        });
      });
    });

    describe('getHitDistribution() method', () => {
      beforeEach(() => {
        for (let i = 1; i <= 5; i++) {
          eventEmitter.emit('cache:put:default', {
            key: `key${i}`,
            value: `value${i}`
          });
          for (let j = 0; j < i; j++) {
            eventEmitter.emit('cache:get:default', {
              key: `key${i}`,
              value: `value${i}`
            });
          }
        }
      });

      test('should return distribution object with labels and data', () => {
        const distribution = analytics.getHitDistribution(5);

        expect(distribution).toHaveProperty('labels');
        expect(distribution).toHaveProperty('data');
        expect(Array.isArray(distribution.labels)).toBe(true);
        expect(Array.isArray(distribution.data)).toBe(true);
      });

      test('should have matching labels and data arrays', () => {
        const distribution = analytics.getHitDistribution(5);

        expect(distribution.labels.length).toBe(distribution.data.length);
      });

      test('should respect limit parameter', () => {
        const dist3 = analytics.getHitDistribution(3);
        const dist10 = analytics.getHitDistribution(10);

        expect(dist3.labels.length).toBeLessThanOrEqual(3);
        expect(dist10.labels.length).toBeLessThanOrEqual(10);
      });
    });

    describe('getTimeline() method', () => {
      beforeEach(() => {
        for (let i = 1; i <= 3; i++) {
          eventEmitter.emit('cache:put:default', {
            key: `key${i}`,
            value: `value${i}`
          });
          for (let j = 0; j < i; j++) {
            eventEmitter.emit('cache:get:default', {
              key: `key${i}`,
              value: `value${i}`
            });
          }
        }
      });

      test('should return timeline object with labels and datasets', () => {
        const timeline = analytics.getTimeline(3);

        expect(timeline).toHaveProperty('labels');
        expect(timeline).toHaveProperty('datasets');
        expect(Array.isArray(timeline.labels)).toBe(true);
        expect(Array.isArray(timeline.datasets)).toBe(true);
      });

      test('should have datasets with name and data', () => {
        const timeline = analytics.getTimeline(3);

        timeline.datasets.forEach(dataset => {
          expect(dataset).toHaveProperty('name');
          expect(dataset).toHaveProperty('data');
          expect(Array.isArray(dataset.data)).toBe(true);
        });
      });

      test('should respect topN parameter', () => {
        const timeline3 = analytics.getTimeline(3);
        const timeline10 = analytics.getTimeline(10);

        expect(timeline3.datasets.length).toBeLessThanOrEqual(3);
        expect(timeline10.datasets.length).toBeLessThanOrEqual(10);
      });
    });

    describe('getKeyList() method', () => {
      beforeEach(() => {
        for (let i = 1; i <= 10; i++) {
          eventEmitter.emit('cache:put:default', {
            key: `key${i}`,
            value: `value${i}`
          });
          for (let j = 0; j < i; j++) {
            eventEmitter.emit('cache:get:default', {
              key: `key${i}`,
              value: `value${i}`
            });
          }
        }
      });

      test('should return array of key information', () => {
        const keyList = analytics.getKeyList(10);

        expect(Array.isArray(keyList)).toBe(true);
      });

      test('should include key statistics', () => {
        const keyList = analytics.getKeyList(10);

        keyList.forEach(key => {
          expect(key).toHaveProperty('name');
          expect(key).toHaveProperty('hitCount');
          expect(key).toHaveProperty('missCount');
          expect(key).toHaveProperty('totalReads');
          expect(key).toHaveProperty('totalWrites');
          expect(key).toHaveProperty('stats');
        });
      });

      test('should respect limit parameter', () => {
        const list5 = analytics.getKeyList(5);
        const list20 = analytics.getKeyList(20);

        expect(list5.length).toBeLessThanOrEqual(5);
        expect(list20.length).toBeLessThanOrEqual(20);
      });
    });

    describe('clear() method', () => {
      beforeEach(() => {
        eventEmitter.emit('cache:put:default', {
          key: 'key1',
          value: 'value1'
        });
        eventEmitter.emit('cache:get:default', {
          key: 'key1',
          value: 'value1'
        });
      });

      test('should clear all analytics data', () => {
        let stats = analytics.getStats();
        expect(stats.totalKeys).toBeGreaterThan(0);

        analytics.clear();

        stats = analytics.getStats();
        expect(stats.totalKeys).toBe(0);
        expect(stats.totalHits).toBe(0);
      });
    });

    describe('getKeyCount() method', () => {
      test('should return number of tracked keys', () => {
        eventEmitter.emit('cache:put:default', {
          key: 'key1',
          value: 'value1'
        });
        eventEmitter.emit('cache:put:default', {
          key: 'key2',
          value: 'value2'
        });

        const count = analytics.getKeyCount();
        expect(count).toBe(2);
      });
    });
  });

  describe('Multiple Instances', () => {
    test('should support named instances', () => {
      const cache1 = new Cache({ instanceName: 'cache1' }, eventEmitter);
      const cache2 = new Cache({ instanceName: 'cache2' }, eventEmitter);

      expect(cache1.instanceName_).toBe('cache1');
      expect(cache2.instanceName_).toBe('cache2');
    });

    test('should emit events with instance name', async () => {
      const cache1 = new Cache({ instanceName: 'cache1' }, eventEmitter);
      const cache2 = new Cache({ instanceName: 'cache2' }, eventEmitter);

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventEmitter.on('cache:put:cache1', handler1);
      eventEmitter.on('cache:put:cache2', handler2);

      await cache1.put('key', 'value1');
      await cache2.put('key', 'value2');

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration Patterns', () => {
    describe('Cache-Aside pattern', () => {
      test('should support cache-aside retrieval pattern', async () => {
        // First access - cache miss
        let value = await cache.get('data:123');
        expect(value).toBeUndefined();

        // Store data
        const data = { id: 123, name: 'Test' };
        await cache.put('data:123', data);

        // Second access - cache hit
        value = await cache.get('data:123');
        expect(value).toEqual(data);

        // Verify analytics - analytics tracks all operations (get + put)
        const analytics = cache.getAnalytics();
        const entry = analytics.find(a => a.key === 'data:123');
        expect(entry.hits).toBe(3); // 1 miss get + 1 put + 1 hit get = 3 tracked operations
      });
    });

    describe('Batch Operations', () => {
      test('should support multiple put operations', async () => {
        const data = {
          'user:1': { name: 'User 1' },
          'user:2': { name: 'User 2' },
          'user:3': { name: 'User 3' }
        };

        for (const [key, value] of Object.entries(data)) {
          await cache.put(key, value);
        }

        const analytics = cache.getAnalytics();
        expect(analytics.length).toBe(3);
      });

      test('should support multiple get operations', async () => {
        await cache.put('key1', 'value1');
        await cache.put('key2', 'value2');

        const v1 = await cache.get('key1');
        const v2 = await cache.get('key2');

        expect(v1).toBe('value1');
        expect(v2).toBe('value2');

        const analytics = cache.getAnalytics();
        expect(analytics).toHaveLength(2);
      });
    });

    describe('Analytics Monitoring', () => {
      test('should track cache efficiency metrics', async () => {
        // Create analytics instance to track operations
        const analytics = new CacheAnalytics(eventEmitter, 'default');

        // Populate cache
        for (let i = 1; i <= 5; i++) {
          await cache.put(`key:${i}`, `value:${i}`);
        }

        // Access with hits and misses
        for (let i = 1; i <= 5; i++) {
          await cache.get(`key:${i}`);
          await cache.get(`key:${i}`); // Hit
        }

        for (let i = 1; i <= 3; i++) {
          await cache.get(`missing:${i}`); // Miss
        }

        const stats = analytics.getStats();

        expect(stats.totalReads).toBe(13); // 10 hits + 3 misses
        expect(stats.totalHits).toBe(10);
        expect(stats.totalMisses).toBe(3);
      });
    });
  });

  describe('Error Handling', () => {
    test('should emit validation error events', async () => {
      const errorHandler = jest.fn();
      eventEmitter.on('cache:validation-error:default', errorHandler);

      try {
        await cache.put('', 'value');
      } catch (err) {
        // Expected
      }

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'put',
          error: expect.stringContaining('Invalid key')
        })
      );
    });
  });
});
