/**
 * @fileoverview AI Service Factory
 * Factory module for creating AI service instances with multiple provider support.
 * Supports claude, openai, openai-kv, ollama, gemini, api.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 * @humanreviewed true
 */

'use strict';

// Providers
const AIClaude = require('./provider/aiclaude');
const AIOpenAI = require('./provider/aiopenai');
const AIOllama = require('./provider/aiollama');
const AIGemini = require('./provider/gemini');
const AITensorFlow = require('./provider/aitensorflow');
const AICommon = require('./provider/aicommon');

/**
 * Feature 02: provider names served by AI Service v2 (nooblyjs-ai-common).
 * The pre-v2 names (claude, openai, chatgpt, ollama, gemini) keep their
 * legacy classes in 1.x unless `legacy: false` is passed; 2.0 removes them.
 * @const {!Set<string>}
 */
const V2_PROVIDERS = new Set([
  'anthropic', 'openai-compatible', 'grok', 'deepseek', 'bedrock', 'vertex', 'azure', 'mock'
]);
const LEGACY_NAMES = new Set(['claude', 'openai', 'chatgpt', 'ollama', 'gemini']);

// Analytics Object
const Analytics = require('./modules/analytics');

// Routes and views
const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates an AI service instance with the specified provider and dependency injection.
 * Automatically configures routes and views for the AI service.
 * @param {string} type - The AI provider type ('claude', 'openai', 'openai-kv', 'ollama', 'gemini', 'default')
 * @param {Object} options - Provider-specific configuration options
 * @param {string} [options.apiKey] - API key for the AI provider (required for claude/chatgpt)
 * @param {string} [options.model] - Model identifier (e.g., 'claude-3-sonnet', 'gpt-4', 'llama2')
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {Object} options.dependencies.caching - Caching service instance
 * @param {Object} options.dependencies.workflow - Workflow service instance
 * @param {Object} options.dependencies.queueing - Queueing service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {AIClaude|AIOpenAI|AIOllama|AIGemini|AIApi} AI service instance with specified provider
 * @throws {Error} When unsupported AI provider type is provided
 * @example
 * const aiService = createAIService('claude', {
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-3-sonnet-20240229',
 *   dependencies: { logging, caching, workflow, queueing }
 * }, eventEmitter);
 *
 * // Generate a response
 * const response = await aiService.generate({
 *   prompt: 'Explain quantum computing in simple terms',
 *   maxTokens: 500
 * });
 * console.log(response.text);
 *
 * // Stream a response
 * await aiService.stream({
 *   prompt: 'Write a story about a robot',
 *   onChunk: (chunk) => console.log(chunk)
 * });
 */
function createAIService(type, options, eventEmitter) {

  // Extract the dependancies from the option
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;
  const cache = dependencies.caching;
  const workflow = dependencies.workflow;
  const queueing = dependencies.queueing;

  // Instantiate the analytics object
  const analytics = new Analytics(eventEmitter, options.instanceName);

  // Create AI service instance based on provider type
  let aiservice;

  // Create AI service instance based on provider type
  const useV2 = V2_PROVIDERS.has(type) || (LEGACY_NAMES.has(type) && providerOptions.legacy === false);
  if (useV2) {
    aiservice = new AICommon({ ...providerOptions, providerName: type }, eventEmitter);
  } else switch (type) {
    case 'claude':
      aiservice = new AIClaude(providerOptions, eventEmitter);
      break;
    case 'openai':
    case 'chatgpt':
      aiservice = new AIOpenAI(providerOptions, eventEmitter);
      break;
    case 'openai-kv':
      // Feature 20b: loaded on demand; the Azure SDKs are optional peer dependencies.
      aiservice = new (require('./provider/aiopenaikv'))(providerOptions, eventEmitter);
      break;
    case 'ollama':
      aiservice = new AIOllama(providerOptions, eventEmitter);
      break;
    case 'gemini':
      aiservice = new AIGemini(providerOptions, eventEmitter);
      break;
    case 'tensorflow':
      aiservice = new AITensorFlow(providerOptions, eventEmitter);
      break;
    default:
      throw new Error(`Unsupported AI provider type: ${type}`);
  }

  // Inject dependencies into AI service
  if (logger) {
    aiservice.logger = logger;
    aiservice.log = (level, message, meta = {}) => {
      if (typeof logger[level] === 'function') {
        logger[level](`[AI:${type.toUpperCase()}] ${message}`, meta);
      }
    };

    if (!useV2 && LEGACY_NAMES.has(type)) {
      aiservice.log('warn', `The "${type}" provider uses the legacy AI layer, removed in 2.0. `
        + 'Pass legacy: false (or use anthropic/openai-compatible/mock/...) for AI Service v2.', { provider: type });
    }

    // Log AI service initialization
    aiservice.log('info', 'AI service initialized', {
      provider: type,
      hasLogging: true,
      hasCaching: !!cache,
      hasWorkflow: !!workflow,
      hasQueueing: !!queueing
    });
  }

  // Inject caching dependency for response caching
  aiservice.cache = cache;
  aiservice.workflow = workflow;
  aiservice.queueing = queueing;

  // Store all dependencies for potential use by provider
  aiservice.dependencies = dependencies;
  aiservice.promptAnalytics = analytics;
  aiservice.getPromptAnalytics = () => analytics.getAnalytics();

  // Initialize routes and views for the AI service
  Routes(options, eventEmitter, aiservice, analytics);
  Views(options, eventEmitter, aiservice);

  // Expose analytics so the registry can remove its listeners on shutdown/reset (P2-6).
  aiservice.analytics = analytics;
  return aiservice;
}

module.exports = createAIService;
