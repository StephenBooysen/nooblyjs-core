/**
 * @fileoverview Ollama Provider
 * Ollama implementation providing local LLM services with token tracking.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AIServiceBase = require('./aibase');
// Built-in fetch: Node 22 and later (engines.node).
const fetch = globalThis.fetch;

/**
 * Resolve the fetch implementation + dispatcher used for the (potentially very
 * long) /api/generate call. Node's global fetch (undici) defaults headersTimeout
 * and bodyTimeout to 300s each; with `stream: false` Ollama only responds once
 * generation has finished, so a local model that takes longer than 5 minutes
 * would otherwise be aborted with UND_ERR_HEADERS_TIMEOUT.
 *
 * A dispatcher must come from the SAME undici instance as the fetch that uses it
 * (passing a userland-undici Agent to the built-in global fetch throws
 * UND_ERR_INVALID_ARG), so when undici is requireable we use ITS fetch together
 * with an Agent whose header/body timeouts are disabled (0). When undici is not
 * available we fall back to the global / node-fetch impl with no dispatcher
 * (node-fetch has no default timeout; built-in fetch keeps its 300s default).
 * connectTimeout is left at its default so a server that is down still fails fast.
 *
 * @return {{fetchImpl: Function, dispatcher: (Object|undefined)}}
 * @private
 */
let ollamaFetchResolved_ = false;
let ollamaFetchImpl_;
let ollamaDispatcher_;
function getOllamaFetch_() {
  if (ollamaFetchResolved_) return { fetchImpl: ollamaFetchImpl_, dispatcher: ollamaDispatcher_ };
  ollamaFetchResolved_ = true;
  try {
    const undici = require('undici');
    if (undici && typeof undici.fetch === 'function' && typeof undici.Agent === 'function') {
      ollamaFetchImpl_ = undici.fetch;
      ollamaDispatcher_ = new undici.Agent({ headersTimeout: 0, bodyTimeout: 0 });
      return { fetchImpl: ollamaFetchImpl_, dispatcher: ollamaDispatcher_ };
    }
  } catch (_) { /* undici unavailable — fall back below */ }
  ollamaFetchImpl_ = fetch;
  ollamaDispatcher_ = undefined;
  return { fetchImpl: ollamaFetchImpl_, dispatcher: ollamaDispatcher_ };
}

/**
 * Ollama provider implementation for local LLM services.
 * @class
 * @extends {AIServiceBase}
 */
class AIOllama extends AIServiceBase {
  /**
   * Initializes the Ollama service.
   * @param {Object} options Configuration options.
   * @param {string} options.endpoint Ollama endpoint (default: http://localhost:11434).
   * @param {string} options.model Model to use (default: llama3.2).
   * @param {EventEmitter} eventEmitter Optional event emitter for AI service events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.settings = {};
    this.settings.desciption = "This provider exposes the ollama settings"
    this.settings.list = [
      {setting: "model", type: "string", values : ['llama3.2']} ,
      {setting: "endpoint", type: "string", values : ['http://localhost:11434']} ,
      {setting: "temperature", type: "number", values : ['0.7']} 
    ]
    
    this.endpoint = options.endpoint || 'http://localhost:11434';
    this.model = options.model || 'llama3.2';
  }

    /**
   * Get all our settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings){
    for (let i = 0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
        this.logger?.info(`[${this.constructor.name}] Setting changed: ${this.settings.list[i].setting}`, {
          setting: this.settings.list[i].setting,
          newValue: settings[this.settings.list[i].setting]
        });
      }
    }
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
      // Use an undici fetch + Agent with header/body timeouts disabled so a slow
      // local generation is never aborted mid-stream (see getOllamaFetch_).
      const { fetchImpl, dispatcher } = getOllamaFetch_();
      const response = await fetchImpl(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          stream: options.stream || false,
          options: {
            temperature: options.temperature || this.settings.temperature || 0.7
          }
        }),
        ...(dispatcher ? { dispatcher } : {})
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
      await this.trackUsage_(usage, this.model, 'ollama');

      const result = {
        content: data.response,
        usage,
        model: this.model,
        provider: 'ollama',
        done: data.done,
        context: data.context
      };

      this.emitPromptComplete_(prompt, result, options);

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
      const response = await fetch(`${this.endpoint}/api/tags`);
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
      const response = await fetch(`${this.endpoint}/api/version`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

module.exports = AIOllama;