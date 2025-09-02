/**
 * @fileoverview OpenAI Provider
 * OpenAI implementation providing LLM services with token tracking.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AIServiceBase = require('./aibase');
const OpenAI = require('openai');

/**
 * OpenAI provider implementation.
 * @class
 * @extends {AIServiceBase}
 */
class AIOpenAI extends AIServiceBase {
  /**
   * Initializes the OpenAI service.
   * @param {Object} options Configuration options.
   * @param {string} options.apiKey OpenAI API key.
   * @param {string} options.model Model to use (default: gpt-3.5-turbo).
   * @param {EventEmitter} eventEmitter Optional event emitter for AI service events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);
    
    if (!options.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    this.model_ = options.model || 'gpt-3.5-turbo';
    this.client_ = new OpenAI({
      apiKey: options.apiKey
    });
  }

  /**
   * Sends a prompt to OpenAI.
   * @param {string} prompt The prompt to send.
   * @param {Object} options Additional options for the request.
   * @param {number} options.maxTokens Maximum tokens in response (default: 1000).
   * @param {number} options.temperature Temperature for response (default: 0.7).
   * @return {Promise<Object>} Response with content and usage data.
   */
  async prompt(prompt, options = {}) {
    try {
      const response = await this.client_.chat.completions.create({
        model: this.model_,
        max_tokens: options.maxTokens || 1000,
        temperature: options.temperature || 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      };

      // Track usage and costs
      await this.trackUsage_(usage, this.model_, 'chatgpt');

      const result = {
        content: response.choices[0].message.content,
        usage,
        model: this.model_,
        provider: 'chatgpt'
      };

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:prompt', { prompt, response: result });
      }

      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:error', { error: error.message, provider: 'chatgpt' });
      }
      throw error;
    }
  }
}

module.exports = AIOpenAI;