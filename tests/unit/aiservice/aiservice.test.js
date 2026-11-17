/**
 * @fileoverview Unit tests for the AI service factory functionality.
 *
 * This test suite covers the core AI service operations including initialization,
 * provider selection, and dependency injection for multiple AI providers
 * (Claude, OpenAI/ChatGPT, Ollama).
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const createAIService = require('../../../src/aiservice');
const EventEmitter = require('events');

/**
 * Test suite for AI service factory operations.
 *
 * Tests the service factory functionality, provider initialization,
 * and dependency injection for different AI providers.
 */
describe('AI Service Factory', () => {
  /** @type {EventEmitter} Mock event emitter for testing AI service events */
  let mockEventEmitter;
  /** @type {Object} Mock options for AI service configuration */
  let mockOptions;
  /** @type {Object} Mock dependencies for dependency injection */
  let mockDependencies;

  /**
   * Set up test environment before each test case.
   * Creates fresh event emitter, options, and dependencies.
   */
  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    mockDependencies = {
      logging: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      },
      caching: {
        put: jest.fn(),
        get: jest.fn(),
        delete: jest.fn()
      },
      workflow: {
        execute: jest.fn(),
        create: jest.fn()
      },
      queueing: {
        enqueue: jest.fn(),
        dequeue: jest.fn()
      }
    };

    mockOptions = {
      dependencies: mockDependencies,
      'express-app': {
        use: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn()
      },
      apiKey: 'test-api-key' // Provide API key for all providers
    };
  });

  /**
   * Test Claude AI service provider initialization.
   *
   * Verifies that the Claude provider can be initialized properly
   * and that all dependencies are injected correctly.
   */
  it('should create Claude AI service with dependencies', () => {
    const aiService = createAIService('anthropic', mockOptions, mockEventEmitter);

    expect(aiService).toBeDefined();
    expect(aiService.logger).toBe(mockDependencies.logging);
    expect(aiService.cache).toBe(mockDependencies.caching);
    expect(aiService.workflow).toBe(mockDependencies.workflow);
    expect(aiService.queueing).toBe(mockDependencies.queueing);
    expect(aiService.dependencies).toBe(mockDependencies);
    expect(mockDependencies.logging.info).toHaveBeenCalledWith(
      '[AI:ANTHROPIC] AI service initialized',
      expect.objectContaining({
        provider: 'anthropic',
        hasLogging: true,
        hasCaching: true,
        hasWorkflow: true,
        hasQueueing: true
      })
    );
  });

  /**
   * Test OpenAI/ChatGPT AI service provider initialization.
   *
   * Verifies that the ChatGPT provider can be initialized properly
   * and that all dependencies are injected correctly.
   */
  it('should create ChatGPT AI service with dependencies', () => {
    const aiService = createAIService('openai-compatible', mockOptions, mockEventEmitter);

    expect(aiService).toBeDefined();
    expect(aiService.logger).toBe(mockDependencies.logging);
    expect(aiService.cache).toBe(mockDependencies.caching);
    expect(aiService.workflow).toBe(mockDependencies.workflow);
    expect(aiService.queueing).toBe(mockDependencies.queueing);
    expect(mockDependencies.logging.info).toHaveBeenCalledWith(
      '[AI:OPENAI-COMPATIBLE] AI service initialized',
      expect.objectContaining({
        provider: 'openai-compatible',
        hasLogging: true,
        hasCaching: true,
        hasWorkflow: true,
        hasQueueing: true
      })
    );
  });

  /**
   * Test Ollama AI service provider initialization.
   *
   * Verifies that the Ollama provider can be initialized properly
   * and that all dependencies are injected correctly.
   */
  it('should create Ollama AI service with dependencies', () => {
    const aiService = createAIService('openai-compatible', mockOptions, mockEventEmitter);

    expect(aiService).toBeDefined();
    expect(aiService.logger).toBe(mockDependencies.logging);
    expect(aiService.cache).toBe(mockDependencies.caching);
    expect(aiService.workflow).toBe(mockDependencies.workflow);
    expect(aiService.queueing).toBe(mockDependencies.queueing);
    expect(mockDependencies.logging.info).toHaveBeenCalledWith(
      '[AI:OPENAI-COMPATIBLE] AI service initialized',
      expect.objectContaining({
        provider: 'openai-compatible',
        hasLogging: true,
        hasCaching: true,
        hasWorkflow: true,
        hasQueueing: true
      })
    );
  });

  /**
   * Test AI service initialization without dependencies.
   *
   * Verifies that the AI service can be initialized without
   * optional dependencies and handles missing dependencies gracefully.
   */
  it('should create AI service without optional dependencies', () => {
    const minimalOptions = {
      'express-app': {
        use: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn()
      },
      apiKey: 'test-api-key'
    };
    const aiService = createAIService('anthropic', minimalOptions, mockEventEmitter);

    expect(aiService).toBeDefined();
    expect(aiService.logger).toBeUndefined();
    expect(aiService.cache).toBeUndefined();
    expect(aiService.workflow).toBeUndefined();
    expect(aiService.queueing).toBeUndefined();
  });

  /**
   * Test AI service with partial dependencies.
   *
   * Verifies that the AI service correctly handles partial dependency injection
   * and only injects available dependencies.
   */
  it('should handle partial dependencies correctly', () => {
    const partialOptions = {
      dependencies: {
        logging: mockDependencies.logging,
        caching: mockDependencies.caching
      },
      'express-app': {
        use: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn()
      },
      apiKey: 'test-api-key'
    };

    const aiService = createAIService('anthropic', partialOptions, mockEventEmitter);

    expect(aiService.logger).toBe(mockDependencies.logging);
    expect(aiService.cache).toBe(mockDependencies.caching);
    expect(aiService.workflow).toBeUndefined();
    expect(aiService.queueing).toBeUndefined();
    expect(mockDependencies.logging.info).toHaveBeenCalledWith(
      '[AI:ANTHROPIC] AI service initialized',
      expect.objectContaining({
        provider: 'anthropic',
        hasLogging: true,
        hasCaching: true,
        hasWorkflow: false,
        hasQueueing: false
      })
    );
  });

  /**
   * Test AI service logging functionality.
   *
   * Verifies that the injected logging functionality works correctly
   * with proper formatting and level handling.
   */
  it('should provide logging functionality when logger is injected', () => {
    const aiService = createAIService('anthropic', mockOptions, mockEventEmitter);

    aiService.log('info', 'Test message', { test: 'data' });
    aiService.log('error', 'Error message');
    aiService.log('invalidLevel', 'Should not log');

    expect(mockDependencies.logging.info).toHaveBeenCalledWith(
      '[AI:ANTHROPIC] Test message',
      { test: 'data' }
    );
    expect(mockDependencies.logging.error).toHaveBeenCalledWith(
      '[AI:ANTHROPIC] Error message',
      {}
    );
  });

  /**
   * Test unsupported AI provider error handling.
   *
   * Verifies that an appropriate error is thrown when an
   * unsupported AI provider type is specified.
   */
  it('should throw error for unsupported AI provider', () => {
    expect(() => {
      createAIService('unsupported', mockOptions, mockEventEmitter);
    }).toThrow('Unsupported AI provider type: unsupported');
  });
});