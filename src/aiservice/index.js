/**
 * @fileoverview AI Service Factory
 * Factory module for creating AI service instances with multiple provider support.
 * Supports claude, chatgpt, ollama.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AIClaude = require('./provider/aiclaude');
const AIOpenAI = require('./provider/aiopenai');
const AIOllama = require('./provider/aiollama');

const Routes = require('./routes');
const Views = require('./views');

/**
 * Creates an AI service instance with the specified provider.
 * Automatically configures routes and views for the AI service.
 * @param {string} type - The AI provider type ('claude', 'chatgpt', 'ollama')
 * @param {Object} options - Provider-specific configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {AIClaude|AIOpenAI|AIOllama} AI service instance with specified provider
 * @throws {Error} When unsupported AI provider type is provided
 */
function createAIService(type, options, eventEmitter) {
  let aiservice;

  // Create AI service instance based on provider type
  switch (type) {
    case 'claude':
      aiservice = new AIClaude(options, eventEmitter);
      break;
    case 'chatgpt':
      aiservice = new AIOpenAI(options, eventEmitter);
      break;
    case 'ollama':
      aiservice = new AIOllama(options, eventEmitter);
      break;
    default:
      throw new Error(`Unsupported AI provider type: ${type}`);
  }

  // Initialize routes and views for the AI service
  Routes(options, eventEmitter, aiservice);
  Views(options, eventEmitter, aiservice);

  return aiservice;
}

module.exports = createAIService;
