/**
 * @fileoverview Unit tests for API Key Authentication middleware.
 * 
 * This test suite covers the API key authentication middleware functionality
 * including validation, various authentication methods, path exclusions, and
 * proper error handling.
 * 
 * @author NooblyJS Team
 * @version 1.2.1
 * @since 1.2.1
 */

'use strict';

const EventEmitter = require('events');
const { createApiKeyAuthMiddleware, generateApiKey, isValidApiKeyFormat } = require('../../../src/middleware/apiKeyAuth');

/**
 * Test suite for API Key Authentication middleware.
 * 
 * Tests various authentication scenarios including valid/invalid keys,
 * different authentication methods, and configuration options.
 */
describe('API Key Authentication Middleware', () => {
  let eventEmitter;
  let mockReq;
  let mockRes;
  let mockNext;
  let validApiKey;

  /**
   * Set up test environment before each test case.
   */
  beforeEach(() => {
    eventEmitter = new EventEmitter();
    jest.spyOn(eventEmitter, 'emit');
    
    validApiKey = 'test-api-key-1234567890abcdef';
    
    mockReq = {
      headers: {},
      query: {},
      path: '/services/caching/api/put/test',
      method: 'POST',
      ip: '127.0.0.1'
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    
    mockNext = jest.fn();
  });

  describe('createApiKeyAuthMiddleware', () => {
    
    it('should create middleware with default options', () => {
      const middleware = createApiKeyAuthMiddleware();
      expect(typeof middleware).toBe('function');
    });
    
    it('should allow requests when requireApiKey is false', () => {
      const middleware = createApiKeyAuthMiddleware({
        requireApiKey: false
      }, eventEmitter);
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
    
    it('should exclude paths matching exclude patterns', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey],
        excludePaths: ['/services/*/status']
      }, eventEmitter);
      
      mockReq.path = '/services/caching/status';
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
    
    it('should reject requests without API key', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      }, eventEmitter);
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'API key is required. Provide it via x-api-key header, Authorization header, or api_key query parameter.',
        code: 'MISSING_API_KEY'
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith('api-auth-failure', expect.objectContaining({
        reason: 'missing-api-key'
      }));
    });
    
    it('should reject requests with invalid API key', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      }, eventEmitter);
      
      mockReq.headers['x-api-key'] = 'invalid-key';
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid API key provided.',
        code: 'INVALID_API_KEY'
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith('api-auth-failure', expect.objectContaining({
        reason: 'invalid-api-key'
      }));
    });
    
    it('should accept valid API key in x-api-key header', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      }, eventEmitter);
      
      mockReq.headers['x-api-key'] = validApiKey;
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.apiKey).toBe(validApiKey);
      expect(eventEmitter.emit).toHaveBeenCalledWith('api-auth-success', expect.objectContaining({
        ip: mockReq.ip,
        path: mockReq.path,
        method: mockReq.method
      }));
    });
    
    it('should accept valid API key in api-key header', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      }, eventEmitter);
      
      mockReq.headers['api-key'] = validApiKey;
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.apiKey).toBe(validApiKey);
    });
    
    it('should accept valid API key in Authorization Bearer header', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      }, eventEmitter);
      
      mockReq.headers.authorization = `Bearer ${validApiKey}`;
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.apiKey).toBe(validApiKey);
    });
    
    it('should accept valid API key in Authorization ApiKey header', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      }, eventEmitter);
      
      mockReq.headers.authorization = `ApiKey ${validApiKey}`;
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.apiKey).toBe(validApiKey);
    });
    
    it('should accept valid API key in query parameter', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      }, eventEmitter);
      
      mockReq.query.api_key = validApiKey;
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.apiKey).toBe(validApiKey);
    });
    
    it('should work without event emitter', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey]
      });
      
      mockReq.headers['x-api-key'] = validApiKey;
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
    
    it('should handle multiple API keys', () => {
      const apiKey2 = 'another-valid-key-xyz123';
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey, apiKey2]
      }, eventEmitter);
      
      mockReq.headers['x-api-key'] = apiKey2;
      
      middleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.apiKey).toBe(apiKey2);
    });
    
    it('should handle complex exclude path patterns', () => {
      const middleware = createApiKeyAuthMiddleware({
        apiKeys: [validApiKey],
        excludePaths: ['/services/*/status', '/services/*/views/*', '/public/*']
      }, eventEmitter);
      
      // Test various excluded paths
      const excludedPaths = [
        '/services/caching/status',
        '/services/dataserve/status',
        '/services/logging/views/index.html',
        '/public/assets/style.css'
      ];
      
      excludedPaths.forEach(path => {
        mockReq.path = path;
        mockNext.mockClear();
        mockRes.status.mockClear();
        
        middleware(mockReq, mockRes, mockNext);
        
        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });
    });
  });

  describe('generateApiKey', () => {
    
    it('should generate API key with default length', () => {
      const apiKey = generateApiKey();
      expect(typeof apiKey).toBe('string');
      expect(apiKey.length).toBe(32);
      expect(/^[A-Za-z0-9]+$/.test(apiKey)).toBe(true);
    });
    
    it('should generate API key with custom length', () => {
      const apiKey = generateApiKey(64);
      expect(apiKey.length).toBe(64);
      expect(/^[A-Za-z0-9]+$/.test(apiKey)).toBe(true);
    });
    
    it('should generate unique API keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('isValidApiKeyFormat', () => {
    
    it('should validate correct API key format', () => {
      expect(isValidApiKeyFormat('abcd1234EFGH5678')).toBe(true);
      expect(isValidApiKeyFormat('a'.repeat(16))).toBe(true);
      expect(isValidApiKeyFormat('1'.repeat(32))).toBe(true);
    });
    
    it('should reject invalid API key format', () => {
      expect(isValidApiKeyFormat('')).toBe(false);
      expect(isValidApiKeyFormat('short')).toBe(false);
      expect(isValidApiKeyFormat('contains-special-chars!')).toBe(false);
      expect(isValidApiKeyFormat('contains spaces')).toBe(false);
      expect(isValidApiKeyFormat(null)).toBe(false);
      expect(isValidApiKeyFormat(undefined)).toBe(false);
      expect(isValidApiKeyFormat(123)).toBe(false);
    });
  });
});