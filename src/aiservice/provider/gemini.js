/**
 * @fileoverview Google Gemini AI Provider
 * Google Gemini implementation providing LLM services with token tracking.
 * Uses the Gemini REST API directly (no SDK dependency required).
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const AIServiceBase = require('./aibase');
// Built-in fetch: Node 22 and later (engines.node).
const fetch = globalThis.fetch;

/**
 * Google Gemini AI provider implementation.
 * @class
 * @extends {AIServiceBase}
 */
class AIGemini extends AIServiceBase {
  /**
   * Initializes the Gemini AI service.
   * @param {Object} options Configuration options.
   * @param {string} options.apikey Gemini API key.
   * @param {string} [options.model] Model to use (default: gemini-2.5-flash).
   * @param {string} [options.endpoint] API base URL (default: https://generativelanguage.googleapis.com).
   * @param {string} [options.apiVersion] API version (default: v1beta).
   * @param {number} [options.maxtokens] Default max output tokens.
   * @param {number} [options.temperature] Default temperature.
   * @param {EventEmitter} eventEmitter Optional event emitter for AI service events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.settings = {};
    this.settings.desciption = "This provider exposes the Google Gemini apis for use by an underlying provider."
    this.settings.list = [
      {setting: "model", type: "string", values : ['gemini-2.5-flash']} ,
      {setting: "apikey", type: "string", values : ['The api key retrieved from https://aistudio.google.com/apikey']} ,
      {setting: "maxtokens", type: "int", values : ['1000']} ,
      {setting: "temperature", type: "number", values : ['0.7']}
    ]

    // Accept the framework-standard `apiKey` while remaining backward
    // compatible with the legacy lowercase `apikey` option.
    const apiKey = options.apiKey || options.apikey;
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.settings.apikey = apiKey;
    this.settings.model = options.model || 'gemini-2.5-flash';
    this.settings.maxtokens = options.maxtokens || 4000;
    this.settings.temperature = options.temperature || 0.7;

    this.endpoint = options.endpoint || 'https://generativelanguage.googleapis.com';
    this.apiVersion = options.apiVersion || 'v1beta';
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
   * Sends a prompt to Gemini.
   * @param {string} prompt The prompt to send.
   * @param {Object} options Additional options for the request.
   * @param {number} options.maxTokens Maximum tokens in response (default: 1000).
   * @param {number} options.temperature Temperature for response (default: 0.7).
   * @return {Promise<Object>} Response with content and usage data.
   */
  async prompt(prompt, options = {}) {
    try {
      const url = `${this.endpoint}/${this.apiVersion}/models/${this.settings.model}:generateContent`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.settings.apikey
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            maxOutputTokens: options.maxTokens || this.settings.maxtokens || 1000,
            temperature: options.temperature ?? this.settings.temperature ?? 0.7
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      const data = await response.json();

      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('') || '';

      if (!content) {
        throw new Error(`Gemini returned no content (finishReason: ${candidate?.finishReason || 'unknown'})`);
      }

      // Gemini reports token counts via usageMetadata
      const meta = data.usageMetadata || {};
      const usage = {
        promptTokens: meta.promptTokenCount || 0,
        completionTokens: meta.candidatesTokenCount || 0,
        totalTokens: meta.totalTokenCount || 0
      };

      // Track usage and costs
      await this.trackUsage_(usage, this.settings.model, 'gemini');

      const result = {
        content,
        usage,
        model: this.settings.model,
        provider: 'gemini'
      };

      this.emitPromptComplete_(prompt, result, options);

      return result;
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:error', { error: error.message, provider: 'gemini' });
      }
      throw error;
    }
  }

  /**
   * Lists available models from Gemini.
   * @return {Promise<Array>} List of available models.
   */
  async listModels() {
    try {
      const response = await fetch(`${this.endpoint}/${this.apiVersion}/models`, {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.settings.apikey
        }
      });
      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      this.logger?.error(`[${this.constructor.name}] Error listing models`, {
        error: error.message,
        provider: 'gemini'
      });
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('ai:error', { error: error.message, provider: 'gemini' });
      }
      throw error;
    }
  }
}

module.exports = AIGemini;
