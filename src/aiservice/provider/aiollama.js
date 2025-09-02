/**
 * @fileoverview Ollama Provider
 * Ollama implementation providing local LLM services with token tracking.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AIServiceBase = require('./aibase');
// Use built-in fetch (Node.js 18+) or fall back to node-fetch
const fetch = globalThis.fetch || require('node-fetch');

/**
 * Ollama provider implementation for local LLM services.
 * @class
 * @extends {AIServiceBase}
 */
class AIOllama extends AIServiceBase {
  /**
   * Initializes the Ollama service.
   * @param {Object} options Configuration options.
   * @param {string} options.baseUrl Ollama base URL (default: http://localhost:11434).
   * @param {string} options.model Model to use (default: llama3.2).
   * @param {EventEmitter} eventEmitter Optional event emitter for AI service events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);
    
    this.baseUrl_ = options.baseUrl || 'http://localhost:11434';
    this.model_ = options.model || 'llama3.2';
  }

  /**
   * Sends a prompt to Ollama.
   * @param {string} prompt The prompt to send.
   * @param {Object} options Additional options for the request.
   * @param {number} options.temperature Temperature for response (default: 0.7).
   * @param {boolean} options.stream Whether to stream response (default: false).
   * @return {Promise<Object>} Response with content and usage data.
   */
  async prompt(prompt, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl_}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model_,
          prompt: prompt,
          stream: options.stream || false,
          options: {
            temperature: options.temperature || 0.7
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Ollama doesn't provide detailed token counts, so we estimate
      const promptTokens = this.estimateTokenCount_(prompt);
      const completionTokens = this.estimateTokenCount_(data.response);
      const totalTokens = promptTokens + completionTokens;

      const usage = {
        promptTokens,
        completionTokens,
        totalTokens
      };

      // Track usage (Ollama is free, so cost is 0)
      await this.trackUsage_(usage, this.model_, 'ollama');

      const result = {
        content: data.response,
        usage,
        model: this.model_,
        provider: 'ollama',
        done: data.done,
        context: data.context
      };

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:prompt', { prompt, response: result });
      }

      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:error', { error: error.message, provider: 'ollama' });
      }
      throw error;
    }
  }

  /**
   * Lists available models from Ollama.
   * @return {Promise<Array>} List of available models.
   */
  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl_}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:error', { error: error.message, provider: 'ollama' });
      }
      throw error;
    }
  }

  /**
   * Estimates token count for text (rough approximation).
   * @param {string} text Text to count tokens for.
   * @return {number} Estimated token count.
   * @private
   */
  estimateTokenCount_(text) {
    if (!text) return 0;
    // Rough approximation: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  }

  /**
   * Checks if Ollama service is running.
   * @return {Promise<boolean>} True if service is running.
   */
  async isRunning() {
    try {
      const response = await fetch(`${this.baseUrl_}/api/version`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

module.exports = AIOllama;