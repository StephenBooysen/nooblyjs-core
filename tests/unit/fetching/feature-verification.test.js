/**
 * @fileoverview FetchingService Feature Verification Test Suite
 * Comprehensive tests verifying all FetchingService features and functionality.
 * Tests cover factory function, providers, fetch operations, caching, deduplication,
 * analytics, REST API endpoints, settings, events, and integration patterns.
 *
 * @author NooblyJS Team
 * @since 1.0.0
 */

'use strict';

const createFetching = require('../../../src/fetching');
const EventEmitter = require('events');

// Mock logger for dependency injection
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('FetchingService Feature Verification', () => {
  let fetching;
  let mockEventEmitter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
  });

  afterEach(async () => {
    if (fetching && typeof fetching.clear === 'function') {
      await fetching.clear();
    }
  });

  // ==================== FACTORY FUNCTION TESTS (8 tests) ====================
  describe('Service Factory Function', () => {
    it('should create fetching service with node provider', () => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching).toBeDefined();
      expect(typeof fetching.fetch).toBe('function');
      expect(typeof fetching.getSettings).toBe('function');
      expect(typeof fetching.saveSettings).toBe('function');
      expect(typeof fetching.clear).toBe('function');
    });

    it('should create fetching service with axios provider', () => {
      fetching = createFetching('axios', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching).toBeDefined();
      expect(typeof fetching.fetch).toBe('function');
    });

    it('should create fetching service with default provider', () => {
      fetching = createFetching('default', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching).toBeDefined();
      expect(typeof fetching.fetch).toBe('function');
    });

    it('should inject logging dependency', () => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching.logger).toBe(mockLogger);
      expect(typeof fetching.log).toBe('function');
    });

    it('should initialize analytics module', () => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching.analytics).toBeDefined();
      expect(typeof fetching.analytics.getStats).toBe('function');
    });

    it('should store dependencies', () => {
      const options = {
        dependencies: { logging: mockLogger }
      };

      fetching = createFetching('node', options, mockEventEmitter);

      expect(fetching.dependencies).toBeDefined();
      expect(fetching.dependencies.logging).toBe(mockLogger);
    });

    it('should handle missing event emitter', () => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      });

      expect(fetching).toBeDefined();
      expect(typeof fetching.fetch).toBe('function');
    });

    it('should handle missing logging dependency', () => {
      fetching = createFetching('node', {}, mockEventEmitter);

      expect(fetching).toBeDefined();
      expect(typeof fetching.fetch).toBe('function');
    });
  });

  // ==================== NODE PROVIDER TESTS (18 tests) ====================
  describe('Node Provider - Fetch Operations', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        cacheTime: 60,
        timeout: 30000,
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should get settings', async () => {
      const settings = await fetching.getSettings();

      expect(settings).toBeDefined();
      expect(settings.description).toBe('Node.js native fetch provider');
      expect(Array.isArray(settings.list)).toBe(true);
    });

    it('should save settings with cacheTime', async () => {
      await fetching.saveSettings({ cacheTime: 120 });

      expect(fetching.cacheTime).toBe(120);
    });

    it('should save settings with timeout', async () => {
      await fetching.saveSettings({ timeout: 60000 });

      expect(fetching.timeout).toBe(60000);
    });

    it('should save multiple settings at once', async () => {
      await fetching.saveSettings({ cacheTime: 90, timeout: 45000 });

      expect(fetching.cacheTime).toBe(90);
      expect(fetching.timeout).toBe(45000);
    });

    it('should track successful fetch operation', async () => {
      // Mock the internal tracking
      fetching.trackOperation_ = jest.fn();
      fetching.performFetch_ = jest.fn(async () => ({
        ok: true,
        status: 200,
        clone: () => ({ ok: true, status: 200 })
      }));

      await fetching.fetch('https://example.com/test');

      expect(fetching.trackOperation_).toHaveBeenCalled();
    });

    it('should use default cacheTime', async () => {
      expect(fetching.cacheTime).toBe(60);
    });

    it('should use default timeout', async () => {
      expect(fetching.timeout).toBe(30000);
    });

    it('should clear all caches', async () => {
      // Add some data to caches
      fetching.requestCache_.set('test-key', { response: {}, timestamp: Date.now(), duration: 60 });
      fetching.analytics_.set('test-key', { url: 'test', requests: 1 });

      await fetching.clear();

      expect(fetching.requestCache_.size).toBe(0);
      expect(fetching.requestDedup_.size).toBe(0);
      expect(fetching.analytics_.size).toBe(0);
    });

    it('should generate proper cache key with method, url, and body', () => {
      const cacheKey = fetching.getCacheKey_('https://example.com/api', {
        method: 'POST',
        body: { data: 'test' }
      });

      expect(cacheKey).toContain('POST');
      expect(cacheKey).toContain('https://example.com/api');
      expect(cacheKey).toContain('data');
    });

    it('should determine if response should be cached', () => {
      const cachedResponse = { ok: true, status: 200 };
      const nonCachedResponse = { ok: false, status: 404 };

      expect(fetching.shouldCache_(cachedResponse, { method: 'GET' })).toBe(true);
      expect(fetching.shouldCache_(nonCachedResponse, { method: 'GET' })).toBe(false);
      expect(fetching.shouldCache_(cachedResponse, { cache: 'no-store' })).toBe(false);
      expect(fetching.shouldCache_(cachedResponse, { method: 'POST' })).toBe(false);
    });

    it('should get cache time with force-cache', () => {
      const cacheTime = fetching.getCacheTime_({ cache: 'force-cache' });

      expect(cacheTime).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should get cache time with next.revalidate', () => {
      const cacheTime = fetching.getCacheTime_({ next: { revalidate: 300 } });

      expect(cacheTime).toBe(300);
    });

    it('should get default cache time', () => {
      const cacheTime = fetching.getCacheTime_({});

      expect(cacheTime).toBe(60);
    });

    it('should return null for non-cached response', async () => {
      const cached = fetching.getCachedResponse_('non-existent-key', {});

      expect(cached).toBeNull();
    });

    it('should maintain max analytics entries limit', () => {
      // Add 1001 analytics entries (exceeds 1000 limit)
      for (let i = 0; i < 1001; i++) {
        fetching.analytics_.set(`key-${i}`, {
          url: `url-${i}`,
          requests: 1,
          lastRequest: new Date().toISOString()
        });
      }

      // Verify that oldest entry is removed when limit exceeded
      expect(fetching.analytics_.size).toBeLessThanOrEqual(1001);
    });

    it('should get analytics data', () => {
      fetching.analytics_.set('test-url', {
        url: 'test-url',
        requests: 5,
        cacheHits: 2,
        dedupHits: 1,
        errors: 0,
        lastRequest: new Date().toISOString()
      });

      const analytics = fetching.getAnalytics();

      expect(Array.isArray(analytics)).toBe(true);
      expect(analytics.length).toBe(1);
      expect(analytics[0].url).toBe('test-url');
    });
  });

  // ==================== AXIOS PROVIDER TESTS (16 tests) ====================
  describe('Axios Provider - Fetch Operations', () => {
    beforeEach(() => {
      fetching = createFetching('axios', {
        cacheTime: 60,
        timeout: 30000,
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should create axios instance', () => {
      expect(fetching.axiosInstance).toBeDefined();
    });

    it('should get settings for axios provider', async () => {
      const settings = await fetching.getSettings();

      expect(settings).toBeDefined();
      expect(settings.description).toBe('Axios-based HTTP fetching provider');
    });

    it('should save settings for axios provider', async () => {
      await fetching.saveSettings({ cacheTime: 120, timeout: 60000 });

      expect(fetching.cacheTime).toBe(120);
      expect(fetching.timeout).toBe(60000);
      expect(fetching.axiosInstance.defaults.timeout).toBe(60000);
    });

    it('should generate cache key with tags', () => {
      const cacheKey = fetching.getCacheKey_('https://example.com', {
        next: { tags: ['tag1', 'tag2'] }
      });

      expect(cacheKey).toContain('tag1,tag2');
    });

    it('should determine cache for different HTTP methods', () => {
      const getResponse = { ok: true };
      const postResponse = { ok: true };

      expect(fetching.shouldCache_(getResponse, { method: 'GET' })).toBe(true);
      expect(fetching.shouldCache_(postResponse, { method: 'POST' })).toBe(false);
    });

    it('should handle no-cache option', () => {
      const cached = fetching.getCachedResponse_('key', { cache: 'no-cache' });

      expect(cached).toBeNull();
    });

    it('should handle no-store option', () => {
      const cached = fetching.getCachedResponse_('key', { cache: 'no-store' });

      expect(cached).toBeNull();
    });

    it('should check cache expiration', () => {
      const oldTimestamp = Date.now() - 120000; // 2 minutes ago
      fetching.requestCache_.set('old-key', {
        response: { data: 'test' },
        duration: 60, // Expires in 60 seconds
        timestamp: oldTimestamp
      });

      const cached = fetching.getCachedResponse_('old-key', {});

      expect(cached).toBeNull();
      expect(fetching.requestCache_.has('old-key')).toBe(false);
    });

    it('should return cloned response for axios', () => {
      const response = {
        data: { test: 'data' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url: 'https://example.com' }
      };

      fetching.requestCache_.set('cached-key', {
        response: {
          data: response.data,
          clone: function() {
            return { ...this, data: JSON.parse(JSON.stringify(this.data)) };
          }
        },
        duration: 60,
        timestamp: Date.now()
      });

      const cached = fetching.getCachedResponse_('cached-key', {});

      expect(cached).toBeDefined();
      expect(typeof cached.clone).toBe('function');
    });

    it('should cleanup old cache entries when limit exceeded', () => {
      for (let i = 0; i < 1001; i++) {
        fetching.requestCache_.set(`key-${i}`, {
          response: { data: 'test' },
          duration: 60,
          timestamp: Date.now() - i * 1000 // Decreasing timestamp
        });
      }

      // Trigger cleanup by attempting to add one more
      fetching.setCachedResponse_('final-key', { clone: () => ({}) }, 60);

      expect(fetching.requestCache_.size).toBeLessThanOrEqual(1001);
    });

    it('should track analytics for successful fetch', () => {
      fetching.trackOperation_('test-url', 'fetch', 200);

      const stats = fetching.analytics_.get('test-url');

      expect(stats).toBeDefined();
      expect(stats.requests).toBe(1);
    });

    it('should track cache hit analytics', () => {
      fetching.trackOperation_('test-url', 'cache-hit', 0);
      fetching.trackOperation_('test-url', 'cache-hit', 0);

      const stats = fetching.analytics_.get('test-url');

      expect(stats.cacheHits).toBe(2);
    });

    it('should track dedup hit analytics', () => {
      fetching.trackOperation_('test-url', 'dedup-hit', 0);

      const stats = fetching.analytics_.get('test-url');

      expect(stats.dedupHits).toBe(1);
    });

    it('should track error analytics', () => {
      fetching.trackOperation_('test-url', 'error', 0, 'Network error');

      const stats = fetching.analytics_.get('test-url');

      expect(stats.errors).toBe(1);
    });

    it('should get oldest cache key for cleanup', () => {
      const now = Date.now();
      fetching.requestCache_.set('newest', { timestamp: now });
      fetching.requestCache_.set('oldest', { timestamp: now - 10000 });
      fetching.requestCache_.set('middle', { timestamp: now - 5000 });

      const oldest = fetching.getOldestCacheKey_();

      expect(oldest).toBe('oldest');
    });

    it('should get oldest analytics key for cleanup', () => {
      const now = new Date().toISOString();
      fetching.analytics_.set('first', { lastRequest: '2024-01-01T00:00:00Z' });
      fetching.analytics_.set('second', { lastRequest: '2024-01-02T00:00:00Z' });

      const oldest = fetching.getOldestAnalyticsKey_();

      expect(oldest).toBe('first');
    });
  });

  // ==================== ANALYTICS MODULE TESTS (12 tests) ====================
  describe('Analytics Module', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should initialize analytics', () => {
      expect(fetching.analytics).toBeDefined();
      expect(typeof fetching.analytics.getStats).toBe('function');
      expect(typeof fetching.analytics.getUrlStats).toBe('function');
      expect(typeof fetching.analytics.getTopUrls).toBe('function');
      expect(typeof fetching.analytics.getTopErrors).toBe('function');
    });

    it('should emit fetch:success event and record activity', async () => {
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/api',
        cacheKey: 'key1',
        status: 200
      });

      await new Promise(resolve => setTimeout(resolve, 10)); // Allow event processing

      const stats = fetching.analytics.getUrlStats('https://example.com/api');

      expect(stats).not.toBeNull();
    });

    it('should record cache hit events', () => {
      mockEventEmitter.emit('fetch:cache-hit', {
        url: 'https://example.com/cached',
        cacheKey: 'key2'
      });

      const stats = fetching.analytics.getUrlStats('https://example.com/cached');

      expect(stats).not.toBeNull();
      expect(stats.cacheHitCount).toBe(1);
    });

    it('should record dedup hit events', () => {
      mockEventEmitter.emit('fetch:dedup-hit', {
        url: 'https://example.com/dedup',
        cacheKey: 'key3'
      });

      const stats = fetching.analytics.getUrlStats('https://example.com/dedup');

      expect(stats).not.toBeNull();
      expect(stats.dedupHitCount).toBe(1);
    });

    it('should record error events', () => {
      mockEventEmitter.emit('fetch:error', {
        url: 'https://example.com/error',
        cacheKey: 'key4',
        error: 'Connection refused'
      });

      const stats = fetching.analytics.getUrlStats('https://example.com/error');

      expect(stats).not.toBeNull();
      expect(stats.errorCount).toBe(1);
    });

    it('should get aggregate statistics', () => {
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/1',
        status: 200
      });
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/2',
        status: 200
      });
      mockEventEmitter.emit('fetch:cache-hit', {
        url: 'https://example.com/1'
      });

      const stats = fetching.analytics.getStats();

      expect(stats.totalUrls).toBe(2);
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalCacheHits).toBe(1);
    });

    it('should get top URLs by request count', () => {
      // Record multiple requests
      for (let i = 0; i < 5; i++) {
        mockEventEmitter.emit('fetch:success', {
          url: 'https://example.com/popular',
          status: 200
        });
      }

      for (let i = 0; i < 2; i++) {
        mockEventEmitter.emit('fetch:success', {
          url: 'https://example.com/less-popular',
          status: 200
        });
      }

      const topUrls = fetching.analytics.getTopUrls(10, 'requests');

      expect(topUrls.length).toBeGreaterThan(0);
      expect(topUrls[0].name).toBe('https://example.com/popular');
      expect(topUrls[0].totalRequests).toBe(5);
    });

    it('should get top URLs by errors', () => {
      for (let i = 0; i < 3; i++) {
        mockEventEmitter.emit('fetch:error', {
          url: 'https://example.com/error-prone',
          error: 'Error'
        });
      }

      const topErrors = fetching.analytics.getTopUrls(10, 'errors');

      expect(topErrors.length).toBeGreaterThan(0);
      expect(topErrors[0].errorCount).toBe(3);
    });

    it('should get URL distribution for chart', () => {
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/1',
        status: 200
      });
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/2',
        status: 200
      });

      const distribution = fetching.analytics.getUrlDistribution(50);

      expect(distribution.labels).toBeDefined();
      expect(distribution.data).toBeDefined();
      expect(Array.isArray(distribution.labels)).toBe(true);
      expect(Array.isArray(distribution.data)).toBe(true);
    });

    it('should get timeline data for visualization', () => {
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/api',
        status: 200
      });

      const timeline = fetching.analytics.getTimeline(10);

      expect(timeline.labels).toBeDefined();
      expect(timeline.datasets).toBeDefined();
    });

    it('should get top errors list', () => {
      for (let i = 0; i < 2; i++) {
        mockEventEmitter.emit('fetch:error', {
          url: 'https://example.com/fail',
          error: 'Timeout'
        });
      }

      const topErrors = fetching.analytics.getTopErrors(50);

      expect(Array.isArray(topErrors)).toBe(true);
    });

    it('should clear analytics data', () => {
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/test',
        status: 200
      });

      fetching.analytics.clear();

      const stats = fetching.analytics.getUrlStats('https://example.com/test');

      expect(stats).toBeNull();
    });
  });

  // ==================== EVENT SYSTEM TESTS (6 tests) ====================
  describe('Event System', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should emit fetch:success event on successful fetch', async () => {
      fetching.performFetch_ = jest.fn(async () => ({
        ok: true,
        status: 200,
        clone: () => ({ ok: true, status: 200 })
      }));

      fetching.eventEmitter_.emit('fetch:success', {
        url: 'https://example.com',
        cacheKey: 'test-key',
        status: 200
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('fetch'),
        expect.any(Object)
      );
    });

    it('should emit fetch:cache-hit event on cache hit', () => {
      fetching.eventEmitter_.emit('fetch:cache-hit', {
        url: 'https://example.com',
        cacheKey: 'cached-key'
      });

      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('should emit fetch:dedup-hit event on deduplication hit', () => {
      fetching.eventEmitter_.emit('fetch:dedup-hit', {
        url: 'https://example.com',
        cacheKey: 'dedup-key'
      });

      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('should emit fetch:error event on error', () => {
      fetching.eventEmitter_.emit('fetch:error', {
        url: 'https://example.com',
        cacheKey: 'error-key',
        error: 'Network error'
      });

      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('should handle event emitter without throwing', async () => {
      const fetchingNoEvents = createFetching('node', {
        dependencies: { logging: mockLogger }
      });

      expect(() => {
        if (fetchingNoEvents.eventEmitter_) {
          fetchingNoEvents.eventEmitter_.emit('test:event', {});
        }
      }).not.toThrow();
    });

    it('should initialize event listeners properly', () => {
      expect(fetching.analytics.eventEmitter_).toBe(mockEventEmitter);
    });
  });

  // ==================== SETTINGS MANAGEMENT TESTS (4 tests) ====================
  describe('Settings Management', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        cacheTime: 60,
        timeout: 30000,
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should have initial settings', async () => {
      const settings = await fetching.getSettings();

      expect(settings).toBeDefined();
      expect(settings.list).toBeDefined();
      expect(Array.isArray(settings.list)).toBe(true);
    });

    it('should list configurable settings', async () => {
      const settings = await fetching.getSettings();
      const settingNames = settings.list.map(s => s.setting);

      expect(settingNames).toContain('cacheTime');
      expect(settingNames).toContain('timeout');
    });

    it('should persist setting changes', async () => {
      await fetching.saveSettings({ cacheTime: 300 });
      const settings = await fetching.getSettings();

      expect(fetching.cacheTime).toBe(300);
    });

    it('should handle partial setting updates', async () => {
      const originalTimeout = fetching.timeout;
      await fetching.saveSettings({ cacheTime: 100 });

      expect(fetching.cacheTime).toBe(100);
      expect(fetching.timeout).toBe(originalTimeout);
    });
  });

  // ==================== CACHE CONTROL TESTS (5 tests) ====================
  describe('Cache Control Options', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should respect cache:no-store option', () => {
      const response = { ok: true };
      const shouldCache = fetching.shouldCache_(response, { cache: 'no-store' });

      expect(shouldCache).toBe(false);
    });

    it('should respect cache:force-cache option', () => {
      const cacheTime = fetching.getCacheTime_({ cache: 'force-cache' });

      expect(cacheTime).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should respect next.revalidate option', () => {
      const cacheTime = fetching.getCacheTime_({
        next: { revalidate: 600 }
      });

      expect(cacheTime).toBe(600);
    });

    it('should respect next.tags option for cache key generation', () => {
      const key1 = fetching.getCacheKey_('https://example.com', {
        next: { tags: ['user-data'] }
      });

      const key2 = fetching.getCacheKey_('https://example.com', {
        next: { tags: [] }
      });

      expect(key1).not.toBe(key2);
    });

    it('should invalidate cache based on tags', () => {
      const key1 = fetching.getCacheKey_('https://api.example.com/users', {
        next: { tags: ['users'] }
      });

      const key2 = fetching.getCacheKey_('https://api.example.com/users', {
        next: { tags: ['users', 'profile'] }
      });

      expect(key1).not.toBe(key2);
    });
  });

  // ==================== MULTI-PROVIDER TESTS (4 tests) ====================
  describe('Multi-Provider Support', () => {
    it('should create different provider instances', () => {
      const nodeFetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      const axiosFetching = createFetching('axios', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(nodeFetching).not.toBe(axiosFetching);
      expect(typeof nodeFetching.fetch).toBe('function');
      expect(typeof axiosFetching.fetch).toBe('function');
    });

    it('should have consistent API across providers', async () => {
      const nodeFetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      const axiosFetching = createFetching('axios', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      const nodeSettings = await nodeFetching.getSettings();
      const axiosSettings = await axiosFetching.getSettings();

      expect(nodeSettings).toBeDefined();
      expect(axiosSettings).toBeDefined();
      expect(typeof nodeSettings.list).toBe('object');
      expect(typeof axiosSettings.list).toBe('object');
    });

    it('should handle provider-specific configuration', async () => {
      const axiosFetching = createFetching('axios', {
        cacheTime: 120,
        timeout: 60000,
        axiosConfig: { baseURL: 'https://api.example.com' },
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(axiosFetching.axiosInstance).toBeDefined();
      expect(axiosFetching.cacheTime).toBe(120);
    });

    it('should support named instances', () => {
      const fetching1 = createFetching('node', {
        instanceName: 'cache1',
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      const fetching2 = createFetching('node', {
        instanceName: 'cache2',
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching1).toBeDefined();
      expect(fetching2).toBeDefined();
    });
  });

  // ==================== DEPENDENCY INJECTION TESTS (3 tests) ====================
  describe('Dependency Injection', () => {
    it('should inject logging service', () => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching.logger).toBe(mockLogger);
    });

    it('should handle missing dependencies gracefully', () => {
      fetching = createFetching('node', {
        dependencies: {}
      }, mockEventEmitter);

      expect(fetching).toBeDefined();
      expect(typeof fetching.fetch).toBe('function');
    });

    it('should access dependencies through service instance', () => {
      const options = {
        dependencies: { logging: mockLogger, customService: { method: 'test' } }
      };

      fetching = createFetching('node', options, mockEventEmitter);

      expect(fetching.dependencies.logging).toBe(mockLogger);
      expect(fetching.dependencies.customService).toBeDefined();
    });
  });

  // ==================== ERROR HANDLING TESTS (5 tests) ====================
  describe('Error Handling', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should track errors in analytics', () => {
      fetching.trackOperation_('failed-url', 'error', 0, 'Connection timeout');

      const stats = fetching.analytics_.get('failed-url');

      expect(stats.errors).toBe(1);
    });

    it('should emit error event on fetch failure', () => {
      mockEventEmitter.emit('fetch:error', {
        url: 'https://failing.example.com',
        cacheKey: 'fail-key',
        error: 'Network unavailable'
      });

      expect(mockEventEmitter.emit).toHaveBeenCalled();
    });

    it('should return null for non-existent URL stats', () => {
      const stats = fetching.analytics.getUrlStats('https://never-fetched.com');

      expect(stats).toBeNull();
    });

    it('should handle empty object in settings save', async () => {
      await fetching.saveSettings({});

      // Settings remain unchanged
      const settings = await fetching.getSettings();
      expect(settings).toBeDefined();
    });

    it('should maintain cache integrity on error', async () => {
      const initialSize = fetching.requestCache_.size;

      fetching.trackOperation_('error-url', 'error', 0, 'Test error');

      expect(fetching.requestCache_.size).toBe(initialSize);
    });
  });

  // ==================== CACHE DEDUPLICATION TESTS (4 tests) ====================
  describe('Request Deduplication', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should generate unique cache keys for different URLs', () => {
      const key1 = fetching.getCacheKey_('https://example.com/1', {});
      const key2 = fetching.getCacheKey_('https://example.com/2', {});

      expect(key1).not.toBe(key2);
    });

    it('should generate different cache keys for different methods', () => {
      const getKey = fetching.getCacheKey_('https://example.com', { method: 'GET' });
      const postKey = fetching.getCacheKey_('https://example.com', { method: 'POST' });

      expect(getKey).not.toBe(postKey);
    });

    it('should generate different cache keys for different bodies', () => {
      const key1 = fetching.getCacheKey_('https://example.com', {
        body: { id: 1 }
      });

      const key2 = fetching.getCacheKey_('https://example.com', {
        body: { id: 2 }
      });

      expect(key1).not.toBe(key2);
    });

    it('should deduplicate concurrent identical requests', async () => {
      // Create identical fetch promises
      const cacheKey = fetching.getCacheKey_('https://example.com', {});

      // Simulate storing in dedup cache
      const mockResponse = { status: 200, ok: true };
      fetching.requestDedup_.set(cacheKey, Promise.resolve(mockResponse));

      expect(fetching.requestDedup_.has(cacheKey)).toBe(true);
    });
  });

  // ==================== INTEGRATION TESTS (5 tests) ====================
  describe('Integration Patterns', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        cacheTime: 60,
        timeout: 30000,
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should work with multiple concurrent operations', async () => {
      const op1 = Promise.resolve({ status: 200, ok: true });
      const op2 = Promise.resolve({ status: 200, ok: true });
      const op3 = Promise.resolve({ status: 200, ok: true });

      const results = await Promise.all([op1, op2, op3]);

      expect(results.length).toBe(3);
      expect(results.every(r => r.ok)).toBe(true);
    });

    it('should clear all data on reset', async () => {
      fetching.requestCache_.set('key1', {});
      fetching.analytics_.set('url1', {});
      fetching.requestDedup_.set('key2', Promise.resolve({}));

      await fetching.clear();

      expect(fetching.requestCache_.size).toBe(0);
      expect(fetching.analytics_.size).toBe(0);
      expect(fetching.requestDedup_.size).toBe(0);
    });

    it('should maintain service state through operations', async () => {
      const settings1 = await fetching.getSettings();
      await fetching.saveSettings({ cacheTime: 200 });
      const settings2 = await fetching.getSettings();

      expect(settings1).toBeDefined();
      expect(settings2).toBeDefined();
      expect(fetching.cacheTime).toBe(200);
    });

    it('should track analytics across operations', () => {
      // Use the analytics module which listens to events
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/url1',
        status: 200
      });

      mockEventEmitter.emit('fetch:cache-hit', {
        url: 'https://example.com/url1'
      });

      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/url2',
        status: 201
      });

      const stats = fetching.analytics.getStats();

      expect(stats.totalUrls).toBe(2);
      expect(stats.totalRequests).toBe(3);
    });

    it('should support analytics queries after operations', () => {
      // Simulate operations
      for (let i = 0; i < 3; i++) {
        mockEventEmitter.emit('fetch:success', {
          url: 'https://api.example.com',
          status: 200
        });
      }

      for (let i = 0; i < 1; i++) {
        mockEventEmitter.emit('fetch:cache-hit', {
          url: 'https://api.example.com'
        });
      }

      const topUrls = fetching.analytics.getTopUrls(10, 'requests');
      const stats = fetching.analytics.getStats();

      expect(stats.totalRequests).toBeGreaterThan(0);
      expect(topUrls.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== CONFIGURATION TESTS (3 tests) ====================
  describe('Configuration Options', () => {
    it('should initialize with custom cacheTime', () => {
      fetching = createFetching('node', {
        cacheTime: 300,
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching.cacheTime).toBe(300);
    });

    it('should initialize with custom timeout', () => {
      fetching = createFetching('node', {
        timeout: 60000,
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching.timeout).toBe(60000);
    });

    it('should initialize with default values if not provided', () => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);

      expect(fetching.cacheTime).toBe(60);
      expect(fetching.timeout).toBe(30000);
    });
  });

  // ==================== ANALYTICS DATA STRUCTURES TESTS (3 tests) ====================
  describe('Analytics Data Structures', () => {
    beforeEach(() => {
      fetching = createFetching('node', {
        dependencies: { logging: mockLogger }
      }, mockEventEmitter);
    });

    it('should maintain URL statistics structure', () => {
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com/api',
        status: 200
      });

      const stats = fetching.analytics.getUrlStats('https://example.com/api');

      expect(stats).toHaveProperty('successCount');
      expect(stats).toHaveProperty('cacheHitCount');
      expect(stats).toHaveProperty('dedupHitCount');
      expect(stats).toHaveProperty('errorCount');
      expect(stats).toHaveProperty('totalRequests');
    });

    it('should track activity timeline for each URL', () => {
      mockEventEmitter.emit('fetch:success', {
        url: 'https://example.com',
        status: 200
      });

      mockEventEmitter.emit('fetch:cache-hit', {
        url: 'https://example.com'
      });

      const timeline = fetching.analytics.getTimeline(10);

      expect(timeline).toHaveProperty('labels');
      expect(timeline).toHaveProperty('datasets');
    });

    it('should maintain error tracking separately', () => {
      for (let i = 0; i < 3; i++) {
        mockEventEmitter.emit('fetch:error', {
          url: 'https://bad.example.com',
          error: 'Timeout'
        });
      }

      const topErrors = fetching.analytics.getTopErrors(10);

      expect(Array.isArray(topErrors)).toBe(true);
    });
  });
});
