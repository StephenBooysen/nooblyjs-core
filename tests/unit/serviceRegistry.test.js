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
        serviceRegistry.initialize(app, null, {});
      }).not.toThrow();

      expect(serviceRegistry.initialized).toBe(true);
    });

    it('should initialize with API key configuration', () => {
      const apiKeys = [serviceRegistry.generateApiKey()];

      expect(() => {
        serviceRegistry.initialize(app, null, {
          apiKeys,
          requireApiKey: true
        });
      }).not.toThrow();

      expect(serviceRegistry.initialized).toBe(true);
    });
    
    it('should create services after initialization', () => {
      serviceRegistry.initialize(app, null, {});

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
      serviceRegistry.initialize(app, null, {});

      const cache = serviceRegistry.cache('memory');
      const logger = serviceRegistry.logger('console');

      const services = serviceRegistry.listServices();
      expect(services).toContain('caching:memory:default');
      expect(services).toContain('logging:console:default');
    });

    it('should return singleton instances', () => {
      serviceRegistry.initialize(app, null, {});

      const cache1 = serviceRegistry.cache('memory');
      const cache2 = serviceRegistry.cache('memory');

      expect(cache1).toBe(cache2);
    });

    it('should create different instances for different provider types', () => {
      serviceRegistry.initialize(app, null, {});

      const memoryCache = serviceRegistry.cache('memory');
      const redisCache = serviceRegistry.cache('redis');

      expect(memoryCache).not.toBe(redisCache);
    });
  });

  describe('API Key Authentication Integration', () => {
    let validApiKey;

    beforeEach(() => {
      // Reset registry and app before each test in this suite
      app = express();
      app.use(express.json());
      ServiceRegistry.reset();
      serviceRegistry = ServiceRegistry;
      validApiKey = serviceRegistry.generateApiKey();
    });
    
    it('should emit setup event when API keys are configured', (done) => {
      // Need to get the event emitter before initializing
      const eventEmitter = new (require('events'))();

      eventEmitter.on('api-auth-setup', (data) => {
        expect(data).toMatchObject({
          message: 'API key authentication configured',
          keyCount: 1,
          requireApiKey: true
        });
        done();
      });

      serviceRegistry.initialize(app, eventEmitter, {
        apiKeys: [validApiKey],
        requireApiKey: true
      });
    });
    
    it('should protect API endpoints when API keys are configured', async () => {
      serviceRegistry.initialize(app, null, {
        apiKeys: [validApiKey],
        requireApiKey: true,
        security: { servicesAuth: { requireLogin: false } }
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
      serviceRegistry.initialize(app, null, {
        apiKeys: [validApiKey],
        requireApiKey: true,
        security: { servicesAuth: { requireLogin: false } }
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
      serviceRegistry.initialize(app, null, {
        apiKeys: [validApiKey],
        requireApiKey: true,
        security: { servicesAuth: { requireLogin: false } }
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

      serviceRegistry.initialize(app, null, {
        apiKeys: [apiKey1, apiKey2],
        requireApiKey: true,
        security: { servicesAuth: { requireLogin: false } }
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
      serviceRegistry.initialize(app, null, {
        apiKeys: [validApiKey],
        requireApiKey: false,
        security: { servicesAuth: { requireLogin: false } }
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
      // Reset registry and app before each test in this suite
      app = express();
      app.use(express.json());
      ServiceRegistry.reset();
      serviceRegistry = ServiceRegistry;
      serviceRegistry.initialize(app, null, {});
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
    
    it('should create dataservice services', () => {
      const dataService = serviceRegistry.dataService('memory');
      expect(dataService).toBeDefined();

      const fileDataService = serviceRegistry.dataService('file');
      expect(fileDataService).toBeDefined();
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
      // Reset registry and app before each test in this suite
      app = express();
      app.use(express.json());
      ServiceRegistry.reset();
      serviceRegistry = ServiceRegistry;
      serviceRegistry.initialize(app, null, {});
    });

    it('should provide event emitter', () => {
      const eventEmitter = serviceRegistry.getEventEmitter();
      expect(eventEmitter).toBeDefined();
      expect(typeof eventEmitter.on).toBe('function');
      expect(typeof eventEmitter.emit).toBe('function');
    });

    it('should emit events correctly', () => {
      const eventEmitter = serviceRegistry.getEventEmitter();
      const mockHandler = jest.fn();

      eventEmitter.on('test-event', mockHandler);
      eventEmitter.emit('test-event', 'test-data');

      expect(mockHandler).toHaveBeenCalledWith('test-data');
    });
  });

  describe('Multiple Service Instances', () => {

    beforeEach(() => {
      // Create a fresh app and ensure registry is clean
      app = express();
      app.use(express.json());
      ServiceRegistry.reset();
      serviceRegistry = ServiceRegistry;
      serviceRegistry.initialize(app, null, {});
    });

    it('should create default instance when no instanceName is provided', () => {
      const cache = serviceRegistry.cache('memory');
      expect(cache).toBeDefined();

      const services = serviceRegistry.listServices();
      expect(services).toContain('caching:memory:default');
    });

    it('should create named instances with explicit instanceName', () => {
      const cache1 = serviceRegistry.getService('caching', 'memory', { instanceName: 'cache1' });
      const cache2 = serviceRegistry.getService('caching', 'memory', { instanceName: 'cache2' });

      expect(cache1).toBeDefined();
      expect(cache2).toBeDefined();
      expect(cache1).not.toBe(cache2);

      const services = serviceRegistry.listServices();
      expect(services).toContain('caching:memory:cache1');
      expect(services).toContain('caching:memory:cache2');
    });

    it('should maintain singleton behavior for same instance', () => {
      const cache1a = serviceRegistry.getService('caching', 'memory', { instanceName: 'cache1' });
      const cache1b = serviceRegistry.getService('caching', 'memory', { instanceName: 'cache1' });

      expect(cache1a).toBe(cache1b);
    });

    it('should return null for non-existent instance using getServiceInstance', () => {
      const instance = serviceRegistry.getServiceInstance('caching', 'memory', 'nonexistent');
      expect(instance).toBeNull();
    });

    it('should retrieve existing instance using getServiceInstance', () => {
      const original = serviceRegistry.getService('caching', 'memory', { instanceName: 'test' });
      const retrieved = serviceRegistry.getServiceInstance('caching', 'memory', 'test');

      expect(retrieved).toBe(original);
    });

    it('should list all instances of a service', () => {
      serviceRegistry.getService('caching', 'memory', { instanceName: 'cache1' });
      serviceRegistry.getService('caching', 'memory', { instanceName: 'cache2' });
      serviceRegistry.getService('caching', 'redis', { instanceName: 'cache3' });

      const instances = serviceRegistry.listInstances('caching');
      expect(instances).toHaveLength(3);
      expect(instances.map(i => i.instanceName)).toEqual(expect.arrayContaining(['cache1', 'cache2', 'cache3']));
      expect(instances.map(i => i.providerType)).toEqual(expect.arrayContaining(['memory', 'memory', 'redis']));
    });

    it('should list empty array when no instances exist for a service', () => {
      const instances = serviceRegistry.listInstances('nonexistent');
      expect(instances).toEqual([]);
    });

    it('should reset specific instance', () => {
      const cache1 = serviceRegistry.getService('caching', 'memory', { instanceName: 'cache1' });
      serviceRegistry.getService('caching', 'memory', { instanceName: 'cache2' });

      expect(serviceRegistry.listServices()).toContain('caching:memory:cache1');
      expect(serviceRegistry.listServices()).toContain('caching:memory:cache2');

      const result = serviceRegistry.resetServiceInstance('caching', 'memory', 'cache1');
      expect(result).toBe(true);

      expect(serviceRegistry.listServices()).not.toContain('caching:memory:cache1');
      expect(serviceRegistry.listServices()).toContain('caching:memory:cache2');
    });

    it('should return false when resetting non-existent instance', () => {
      const result = serviceRegistry.resetServiceInstance('caching', 'memory', 'nonexistent');
      expect(result).toBe(false);
    });

    it('should reset all instances of a service', () => {
      serviceRegistry.getService('caching', 'memory', { instanceName: 'cache1' });
      serviceRegistry.getService('caching', 'memory', { instanceName: 'cache2' });
      serviceRegistry.getService('caching', 'redis', { instanceName: 'cache3' });

      const count = serviceRegistry.resetService('caching');
      expect(count).toBe(3);

      const instances = serviceRegistry.listInstances('caching');
      expect(instances).toEqual([]);
    });

    it('should return 0 when resetting non-existent service', () => {
      const count = serviceRegistry.resetService('nonexistent');
      expect(count).toBe(0);
    });

    it('should isolate data between instances', async () => {
      const cache1 = serviceRegistry.getService('caching', 'memory', { instanceName: 'cache1' });
      const cache2 = serviceRegistry.getService('caching', 'memory', { instanceName: 'cache2' });

      await cache1.put('testkey', 'value1');
      await cache2.put('testkey', 'value2');

      const val1 = await cache1.get('testkey');
      const val2 = await cache2.get('testkey');

      expect(val1).toBe('value1');
      expect(val2).toBe('value2');
    });

    it('should emit service:created event with instance information', (done) => {
      const eventEmitter = serviceRegistry.getEventEmitter();

      eventEmitter.on('service:created', (data) => {
        if (data.serviceName === 'caching' && data.instanceName === 'test') {
          expect(data).toMatchObject({
            serviceName: 'caching',
            providerType: 'memory',
            instanceName: 'test'
          });
          done();
        }
      });

      serviceRegistry.getService('caching', 'memory', { instanceName: 'test' });
    });
  });
});