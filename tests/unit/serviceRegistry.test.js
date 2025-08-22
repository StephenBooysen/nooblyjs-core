/**
 * @fileoverview Unit tests for ServiceRegistry with API Key authentication.
 * 
 * This test suite covers the ServiceRegistry functionality including service
 * creation, API key configuration, and middleware integration.
 * 
 * @author NooblyJS Team
 * @version 1.2.1
 * @since 1.2.1
 */

'use strict';

const express = require('express');
const request = require('supertest');
const ServiceRegistry = require('../../index');

/**
 * Test suite for ServiceRegistry functionality.
 * 
 * Tests service creation, API key authentication setup, and middleware
 * integration across different services.
 */
describe('ServiceRegistry', () => {
  let app;
  let serviceRegistry;

  /**
   * Set up test environment before each test case.
   */
  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Reset service registry for each test
    ServiceRegistry.reset();
    serviceRegistry = ServiceRegistry;
  });

  /**
   * Clean up test environment after each test case.
   */
  afterEach(() => {
    ServiceRegistry.reset();
  });

  describe('Basic ServiceRegistry functionality', () => {
    
    it('should initialize without API keys', () => {
      expect(() => {
        serviceRegistry.initialize(app);
      }).not.toThrow();
      
      expect(serviceRegistry.initialized).toBe(true);
    });
    
    it('should initialize with API key configuration', () => {
      const apiKeys = [serviceRegistry.generateApiKey()];
      
      expect(() => {
        serviceRegistry.initialize(app, {
          apiKeys,
          requireApiKey: true
        });
      }).not.toThrow();
      
      expect(serviceRegistry.initialized).toBe(true);
    });
    
    it('should create services after initialization', () => {
      serviceRegistry.initialize(app);
      
      const cache = serviceRegistry.cache('memory');
      expect(cache).toBeDefined();
      expect(typeof cache.put).toBe('function');
      expect(typeof cache.get).toBe('function');
      expect(typeof cache.delete).toBe('function');
    });
    
    it('should throw error when getting service before initialization', () => {
      expect(() => {
        serviceRegistry.cache('memory');
      }).toThrow('ServiceRegistry must be initialized before getting services');
    });
    
    it('should generate API keys', () => {
      const apiKey = serviceRegistry.generateApiKey();
      expect(typeof apiKey).toBe('string');
      expect(apiKey.length).toBe(32);
      expect(/^[A-Za-z0-9]+$/.test(apiKey)).toBe(true);
    });
    
    it('should generate API keys with custom length', () => {
      const apiKey = serviceRegistry.generateApiKey(64);
      expect(apiKey.length).toBe(64);
    });
    
    it('should list initialized services', () => {
      serviceRegistry.initialize(app);
      
      const cache = serviceRegistry.cache('memory');
      const logger = serviceRegistry.logger('console');
      
      const services = serviceRegistry.listServices();
      expect(services).toContain('caching:memory');
      expect(services).toContain('logging:console');
    });
    
    it('should return singleton instances', () => {
      serviceRegistry.initialize(app);
      
      const cache1 = serviceRegistry.cache('memory');
      const cache2 = serviceRegistry.cache('memory');
      
      expect(cache1).toBe(cache2);
    });
    
    it('should create different instances for different provider types', () => {
      serviceRegistry.initialize(app);
      
      const memoryCache = serviceRegistry.cache('memory');
      const redisCache = serviceRegistry.cache('redis');
      
      expect(memoryCache).not.toBe(redisCache);
    });
  });

  describe('API Key Authentication Integration', () => {
    let validApiKey;

    beforeEach(() => {
      validApiKey = serviceRegistry.generateApiKey();
    });
    
    it('should emit setup event when API keys are configured', (done) => {
      serviceRegistry.getEventEmitter().on('api-auth-setup', (data) => {
        expect(data).toMatchObject({
          message: 'API key authentication enabled',
          keyCount: 1,
          requireApiKey: true
        });
        done();
      });
      
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey],
        requireApiKey: true
      });
    });
    
    it('should protect API endpoints when API keys are configured', async () => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey],
        requireApiKey: true
      });
      
      // Create cache service to register routes
      serviceRegistry.cache('memory');
      
      // Test without API key - should fail
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .send({ message: 'test' })
        .expect(401);
      
      expect(response.body).toMatchObject({
        error: 'Unauthorized',
        code: 'MISSING_API_KEY'
      });
    });
    
    it('should allow access with valid API key', async () => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey],
        requireApiKey: true
      });
      
      // Create cache service to register routes
      serviceRegistry.cache('memory');
      
      // Test with valid API key - should succeed
      await request(app)
        .post('/services/caching/api/put/test')
        .set('x-api-key', validApiKey)
        .send({ message: 'test' })
        .expect(200);
    });
    
    it('should allow access to status endpoints without API key', async () => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey],
        requireApiKey: true
      });
      
      // Create cache service to register routes
      serviceRegistry.cache('memory');
      
      // Status endpoint should be accessible without API key
      await request(app)
        .get('/services/caching/api/status')
        .expect(200);
    });
    
    it('should work with multiple API keys', async () => {
      const apiKey1 = serviceRegistry.generateApiKey();
      const apiKey2 = serviceRegistry.generateApiKey();
      
      serviceRegistry.initialize(app, {
        apiKeys: [apiKey1, apiKey2],
        requireApiKey: true
      });
      
      // Create cache service to register routes
      serviceRegistry.cache('memory');
      
      // Both keys should work
      await request(app)
        .post('/services/caching/api/put/test1')
        .set('x-api-key', apiKey1)
        .send({ message: 'test1' })
        .expect(200);
      
      await request(app)
        .post('/services/caching/api/put/test2')
        .set('x-api-key', apiKey2)
        .send({ message: 'test2' })
        .expect(200);
    });
    
    it('should allow disabling API key requirement', async () => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey],
        requireApiKey: false
      });
      
      // Create cache service to register routes
      serviceRegistry.cache('memory');
      
      // Should work without API key when disabled
      await request(app)
        .post('/services/caching/api/put/test')
        .send({ message: 'test' })
        .expect(200);
    });
  });

  describe('Service Creation', () => {
    
    beforeEach(() => {
      serviceRegistry.initialize(app);
    });
    
    it('should create cache services', () => {
      const memoryCache = serviceRegistry.cache('memory');
      expect(memoryCache).toBeDefined();
      
      const redisCache = serviceRegistry.cache('redis');
      expect(redisCache).toBeDefined();
    });
    
    it('should create logging services', () => {
      const consoleLogger = serviceRegistry.logger('console');
      expect(consoleLogger).toBeDefined();
      
      const fileLogger = serviceRegistry.logger('file');
      expect(fileLogger).toBeDefined();
    });
    
    it('should create dataserve services', () => {
      const dataServe = serviceRegistry.dataServe('memory');
      expect(dataServe).toBeDefined();
      
      const fileDataServe = serviceRegistry.dataServe('file');
      expect(fileDataServe).toBeDefined();
    });
    
    it('should create filing services', () => {
      const filing = serviceRegistry.filing('local');
      expect(filing).toBeDefined();
      
      const filer = serviceRegistry.filer('local');
      expect(filer).toBeDefined();
      expect(filing).toBe(filer); // Should be the same service
    });
    
    it('should create other services', () => {
      expect(serviceRegistry.measuring()).toBeDefined();
      expect(serviceRegistry.notifying()).toBeDefined();
      expect(serviceRegistry.queue()).toBeDefined();
      expect(serviceRegistry.scheduling()).toBeDefined();
      expect(serviceRegistry.searching()).toBeDefined();
      expect(serviceRegistry.workflow()).toBeDefined();
      expect(serviceRegistry.working()).toBeDefined();
    });
    
    it('should throw error for invalid service type', () => {
      expect(() => {
        serviceRegistry.getService('nonexistent', 'memory');
      }).toThrow(/Failed to create service/);
    });
  });

  describe('Event Handling', () => {
    
    beforeEach(() => {
      serviceRegistry.initialize(app);
    });
    
    it('should provide event emitter', () => {
      const eventEmitter = serviceRegistry.getEventEmitter();
      expect(eventEmitter).toBeDefined();
      expect(typeof eventEmitter.on).toBe('function');
      expect(typeof eventEmitter.emit).toBe('function');
    });
    
    it('should patch event emitter for debugging', () => {
      const eventEmitter = serviceRegistry.getEventEmitter();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      eventEmitter.emit('test-event', 'test-data');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Caught event: "test-event"'),
        expect.stringContaining('test-data')
      );
      
      consoleSpy.mockRestore();
    });
  });
});