/**
 * @fileoverview Integration tests for API Key authentication across services.
 * 
 * This test suite covers end-to-end API key authentication testing across
 * different services and their API endpoints.
 * 
 * @author NooblyJS Team
 * @version 1.2.1
 * @since 1.2.1
 */

'use strict';

const express = require('express');
const request = require('supertest');
const ServiceRegistry = require('../../../index');

/**
 * Integration test suite for API key authentication.
 * 
 * Tests API key authentication across multiple services and various
 * authentication methods with real HTTP requests.
 */
describe('API Key Authentication Integration', () => {
  let app;
  let serviceRegistry;
  let validApiKey1;
  let validApiKey2;
  
  /**
   * Set up test environment before all tests.
   */
  beforeAll(() => {
    app = express();
    app.use(express.json());
    
    serviceRegistry = ServiceRegistry;
    validApiKey1 = serviceRegistry.generateApiKey(32);
    validApiKey2 = serviceRegistry.generateApiKey(32);
  });
  
  /**
   * Clean up test environment after each test case.
   */
  afterEach(() => {
    ServiceRegistry.reset();
  });
  
  describe('Multi-service API Key Protection', () => {
    
    beforeEach(() => {
      // Initialize with API key authentication
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey1, validApiKey2],
        requireApiKey: true,
        excludePaths: ['/services/*/status', '/services/', '/services/*/views/*']
      });
      
      // Initialize multiple services
      serviceRegistry.cache('memory');
      serviceRegistry.dataServe('memory');
      serviceRegistry.logger('console');
      serviceRegistry.measuring();
      serviceRegistry.queue();
    });
    
    it('should protect all service API endpoints with API key', async () => {
      const testCases = [
        { method: 'post', path: '/services/caching/api/put/test', data: { value: 'test' } },
        { method: 'get', path: '/services/caching/api/get/test', data: null },
        { method: 'delete', path: '/services/caching/api/delete/test', data: null },
        { method: 'post', path: '/services/dataserve/api/put/test', data: { value: 'test' } },
        { method: 'get', path: '/services/dataserve/api/get/test', data: null },
        { method: 'post', path: '/services/logging/api/info', data: { message: 'test' } },
        { method: 'post', path: '/services/measuring/api/add', data: { metric: 'test', value: 1 } },
        { method: 'post', path: '/services/queueing/api/push', data: { message: 'test' } }
      ];
      
      for (const testCase of testCases) {
        // Test without API key - should fail
        let response;
        if (testCase.method === 'post') {
          response = await request(app)
            .post(testCase.path)
            .send(testCase.data || {});
        } else if (testCase.method === 'get') {
          response = await request(app)
            .get(testCase.path);
        } else if (testCase.method === 'delete') {
          response = await request(app)
            .delete(testCase.path);
        }
        
        expect(response.status).toBe(401);
        expect(response.body.code).toBe('MISSING_API_KEY');
      }
    });
    
    it('should allow access with valid API key across services', async () => {
      const testCases = [
        { method: 'post', path: '/services/caching/api/put/test', data: { value: 'test' }, expectedStatus: 200 },
        { method: 'post', path: '/services/dataserve/api/put/test', data: { value: 'test' }, expectedStatus: 200 },
        { method: 'post', path: '/services/logging/api/info', data: { message: 'test' }, expectedStatus: 200 },
        { method: 'post', path: '/services/measuring/api/add', data: { metric: 'test', value: 1 }, expectedStatus: 200 }
      ];
      
      for (const testCase of testCases) {
        let response;
        if (testCase.method === 'post') {
          response = await request(app)
            .post(testCase.path)
            .set('x-api-key', validApiKey1)
            .send(testCase.data);
        }
        
        expect(response.status).toBe(testCase.expectedStatus);
      }
    });
    
    it('should allow status endpoints without API key', async () => {
      const statusEndpoints = [
        '/services/caching/api/status',
        '/services/dataserve/api/status',
        '/services/logging/api/status',
        '/services/measuring/api/status',
        '/services/queueing/api/status'
      ];
      
      for (const endpoint of statusEndpoints) {
        const response = await request(app).get(endpoint);
        expect(response.status).toBe(200);
      }
    });
  });
  
  describe('Different Authentication Methods', () => {
    
    beforeEach(() => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey1, validApiKey2],
        requireApiKey: true
      });
      serviceRegistry.cache('memory');
    });
    
    it('should accept API key in x-api-key header', async () => {
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .set('x-api-key', validApiKey1)
        .send({ message: 'test' });
      
      expect(response.status).toBe(200);
    });
    
    it('should accept API key in api-key header', async () => {
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .set('api-key', validApiKey1)
        .send({ message: 'test' });
      
      expect(response.status).toBe(200);
    });
    
    it('should accept API key in Authorization Bearer header', async () => {
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .set('Authorization', `Bearer ${validApiKey1}`)
        .send({ message: 'test' });
      
      expect(response.status).toBe(200);
    });
    
    it('should accept API key in Authorization ApiKey header', async () => {
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .set('Authorization', `ApiKey ${validApiKey1}`)
        .send({ message: 'test' });
      
      expect(response.status).toBe(200);
    });
    
    it('should accept API key in query parameter', async () => {
      const response = await request(app)
        .post(`/services/caching/api/put/test?api_key=${validApiKey1}`)
        .send({ message: 'test' });
      
      expect(response.status).toBe(200);
    });
    
    it('should prioritize headers over query parameters', async () => {
      const response = await request(app)
        .post(`/services/caching/api/put/test?api_key=invalid-key`)
        .set('x-api-key', validApiKey1)
        .send({ message: 'test' });
      
      expect(response.status).toBe(200);
    });
    
    it('should work with both valid API keys', async () => {
      // Test with first key
      let response = await request(app)
        .post('/services/caching/api/put/test1')
        .set('x-api-key', validApiKey1)
        .send({ message: 'test1' });
      expect(response.status).toBe(200);
      
      // Test with second key
      response = await request(app)
        .post('/services/caching/api/put/test2')
        .set('x-api-key', validApiKey2)
        .send({ message: 'test2' });
      expect(response.status).toBe(200);
    });
  });
  
  describe('Error Response Format', () => {
    
    beforeEach(() => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey1],
        requireApiKey: true
      });
      serviceRegistry.cache('memory');
    });
    
    it('should return proper error format for missing API key', async () => {
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .send({ message: 'test' });
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: 'Unauthorized',
        message: expect.stringContaining('API key is required'),
        code: 'MISSING_API_KEY'
      });
    });
    
    it('should return proper error format for invalid API key', async () => {
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .set('x-api-key', 'invalid-key-123')
        .send({ message: 'test' });
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: 'Unauthorized',
        message: 'Invalid API key provided.',
        code: 'INVALID_API_KEY'
      });
    });
  });
  
  describe('Event Handling', () => {
    
    beforeEach(() => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey1],
        requireApiKey: true
      });
      serviceRegistry.cache('memory');
    });
    
    it('should emit authentication events', (done) => {
      const events = [];
      const eventEmitter = serviceRegistry.getEventEmitter();
      
      eventEmitter.on('api-auth-success', (data) => {
        events.push({ type: 'success', data });
        if (events.length === 1) {
          expect(events[0].data).toMatchObject({
            ip: expect.any(String),
            path: '/services/caching/api/put/test',
            method: 'POST'
          });
          done();
        }
      });
      
      request(app)
        .post('/services/caching/api/put/test')
        .set('x-api-key', validApiKey1)
        .send({ message: 'test' })
        .end(() => {
          // Request completed
        });
    });
    
    it('should emit authentication failure events', (done) => {
      const eventEmitter = serviceRegistry.getEventEmitter();
      
      eventEmitter.on('api-auth-failure', (data) => {
        expect(data).toMatchObject({
          reason: 'missing-api-key',
          ip: expect.any(String),
          path: '/services/caching/api/put/test',
          method: 'POST'
        });
        done();
      });
      
      request(app)
        .post('/services/caching/api/put/test')
        .send({ message: 'test' })
        .end(() => {
          // Request completed
        });
    });
  });
  
  describe('Configuration Options', () => {
    
    it('should work when API key requirement is disabled', async () => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey1],
        requireApiKey: false
      });
      serviceRegistry.cache('memory');
      
      const response = await request(app)
        .post('/services/caching/api/put/test')
        .send({ message: 'test' });
      
      expect(response.status).toBe(200);
    });
    
    it('should respect custom exclude paths', async () => {
      serviceRegistry.initialize(app, {
        apiKeys: [validApiKey1],
        requireApiKey: true,
        excludePaths: ['/services/*/api/get/*', '/services/*/status']
      });
      serviceRegistry.cache('memory');
      
      // PUT should require API key
      let response = await request(app)
        .post('/services/caching/api/put/test')
        .send({ message: 'test' });
      expect(response.status).toBe(401);
      
      // GET should be excluded (if GET endpoints exist)
      response = await request(app)
        .get('/services/caching/api/status');
      expect(response.status).toBe(200);
    });
  });
});