/**
 * @fileoverview Claude AI Provider
 * Claude AI implementation providing LLM services with token tracking.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AIServiceBase = require('./aibase');
const Anthropic = require('@anthropic-ai/sdk');

/**
 * Claude AI provider implementation.
 * @class
 * @extends {AIServiceBase}
 */
class AIClaude extends AIServiceBase {
  /**
   * Initializes the Claude AI service.
   * @param {Object} options Configuration options.
   * @param {string} options.apiKey Claude API key.
   * @param {string} options.model Model to use (default: claude-3-5-sonnet-20241022).
   * @param {EventEmitter} eventEmitter Optional event emitter for AI service events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);
    
    if (!options.apiKey) {
      throw new Error('Claude API key is required');
    }
    
    this.model_ = options.model || 'claude-3-5-sonnet-20241022';
    this.client_ = new Anthropic({
      apiKey: options.apiKey
    });
  }

  /**
   * Sends a prompt to Claude.
   * @param {string} prompt The prompt to send.
   * @param {Object} options Additional options for the request.
   * @param {number} options.maxTokens Maximum tokens in response (default: 1000).
   * @param {number} options.temperature Temperature for response (default: 0.7).
   * @return {Promise<Object>} Response with content and usage data.
   */
  async prompt(prompt, options = {}) {
    try {
      const response = await this.client_.messages.create({
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
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      };

      // Track usage and costs
      await this.trackUsage_(usage, this.model_, 'claude');

      const result = {
        content: response.content[0].text,
        usage,
        model: this.model_,
        provider: 'claude'
      };

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:prompt', { prompt, response: result });
      }

      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:error', { error: error.message, provider: 'claude' });
      }
      throw error;
    }
  }
}

module.exports = AIClaude;
