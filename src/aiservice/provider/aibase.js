/**
 * @fileoverview Base AI Service Provider
 * Base class for AI service providers with token tracking and cost estimation.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const fsnm = require('fs');
const path = require('node:path');

/**
 * Base class for AI service providers with analytics and token tracking.
 * @class
 */
class AIServiceBase {
  /**
   * Initializes the AI service with token tracking and analytics.
   * @param {Object} options Configuration options.
   * @param {string} options.apiKey API key for the provider.
   * @param {string} options.model Model to use for requests.
   * @param {string} options.tokensStorePath Path to store token usage data.
   * @param {EventEmitter} eventEmitter Optional event emitter for AI service events.
   */
  constructor(options = {}, eventEmitter) {
    this.options_ = options;
    this.eventEmitter_ = eventEmitter;
    this.instanceName_ = options.instanceName || 'default';
    // NOOBLYJS_DATA_DIR lets a host (or the Jest setup) move the default, so
    // test runs never write outside .temp/ (review finding L-2).
    const defaultDataDir = process.env.NOOBLYJS_DATA_DIR
      || path.join(process.cwd(), '.application', 'data');
    this.tokensStorePath_ = options.tokensStorePath
      || path.join(options.dataDir || defaultDataDir, 'ai-tokens.json');
    this.analytics_ = new Map();
    this.maxAnalyticsEntries_ = 1000;

    if (!fsnm.existsSync(this.tokensStorePath_)) {
      fsnm.mkdir(path.dirname(this.tokensStorePath_), { recursive: true }, (err) => {});
    }

    // Initialize token data.
    this.tokenData_ = { sessions: [], totalCost: 0, totalTokens: 0 };
    
    // Load existing token data asynchronously
    this.loadTokenData_().catch(() => {
      // Ignore errors - use default empty data
    });
  }

  /**
   * Sends a prompt to the AI service. Must be implemented by subclasses.
   * @param {string} prompt The prompt to send.
   * @param {Object} options Additional options for the request.
   * @return {Promise<Object>} Response with content and usage data.
   * @abstract
   */
  async prompt(prompt, options = {}) {
    throw new Error('prompt method must be implemented by subclass');
  }

  /**
   * Emits the standard 'ai:prompt:complete' analytics event for this instance.
   * The payload is tagged with this provider's instance name so that
   * per-instance Analytics modules only record prompts for their own instance.
   *
   * @param {string} prompt The prompt that was sent.
   * @param {Object} result The provider response ({ content, usage, model, provider }).
   * @param {Object} [options] Prompt options; options.username is included when present.
   * @protected
   */
  emitPromptComplete_(prompt, result = {}, options = {}) {
    if (!this.eventEmitter_) {
      return;
    }
    this.eventEmitter_.emit('ai:prompt:complete', {
      prompt,
      username: options.username,
      instanceName: this.instanceName_,
      usage: result.usage,
      model: result.model,
      provider: result.provider,
      response: result
    });
  }

  /**
   * Tracks token usage and estimated costs.
   * @param {Object} usage Token usage data.
   * @param {number} usage.promptTokens Number of prompt tokens.
   * @param {number} usage.completionTokens Number of completion tokens.
   * @param {number} usage.totalTokens Total number of tokens.
   * @param {string} model Model used for the request.
   * @param {string} provider Provider name.
   * @private
   */
  async trackUsage_(usage, model, provider) {
    const timestamp = new Date().toISOString();
    const cost = this.estimateCost_(usage, model, provider);
    
    const usageRecord = {
      timestamp,
      provider,
      model,
      ...usage,
      estimatedCost: cost
    };

    // Track in analytics
    this.trackOperation_(model);
    
    // Store to JSON file
    await this.saveTokenData_(usageRecord);
    
    // Emit event
    if (this.eventEmitter_) {
      this.eventEmitter_.emit('ai:usage', usageRecord);
    }
  }

  /**
   * Estimates cost based on token usage and provider.
   * @param {Object} usage Token usage data.
   * @param {string} model Model name.
   * @param {string} provider Provider name.
   * @return {number} Estimated cost in USD.
   * @private
   */
  estimateCost_(usage, model, provider) {
    // Basic cost estimation - can be enhanced with actual pricing
    const costPerToken = {
      claude: { input: 0.000003, output: 0.000015 },
      chatgpt: { input: 0.0000005, output: 0.0000015 },
      gemini: { input: 0.0000003, output: 0.0000025 },
      ollama: { input: 0, output: 0 }
    };

    const rates = costPerToken[provider] || { input: 0, output: 0 };
    return (usage.promptTokens || 0) * rates.input + (usage.completionTokens || 0) * rates.output;
  }

  /**
   * Loads token data from JSON file.
   * @private
   */
  async loadTokenData_() {
    try {
      const data = await fs.readFile(this.tokensStorePath_, 'utf8');
      this.tokenData_ = JSON.parse(data);
    } catch (error) {
      this.tokenData_ = { sessions: [], totalCost: 0, totalTokens: 0 };
    }
  }

  /**
   * Saves token usage data to JSON file.
   * @param {Object} usageRecord Usage record to save.
   * @private
   */
  async saveTokenData_(usageRecord) {
    this.tokenData_.sessions.push(usageRecord);
    this.tokenData_.totalCost += usageRecord.estimatedCost;
    this.tokenData_.totalTokens += usageRecord.totalTokens;
    
    // Keep only last 1000 sessions
    if (this.tokenData_.sessions.length > 1000) {
      this.tokenData_.sessions = this.tokenData_.sessions.slice(-1000);
    }

    try {
      await fs.writeFile(this.tokensStorePath_, JSON.stringify(this.tokenData_, null, 2));
    } catch (error) {
      console.error('Error saving token data:', error);
    }
  }

  /**
   * Gets usage analytics data.
   * @return {Object} Analytics data with usage statistics.
   */
  getAnalytics() {
    const analytics = Array.from(this.analytics_.values());
    return {
      modelUsage: analytics.map((entry) => ({
        model: entry.key,
        requests: entry.hits,
        lastUsed: entry.lastHit.toISOString(),
      })),
      totalSessions: this.tokenData_.sessions.length,
      totalCost: this.tokenData_.totalCost,
      totalTokens: this.tokenData_.totalTokens
    };
  }

  /**
   * Tracks an operation for analytics.
   * @param {string} model The model being used.
   * @private
   */
  trackOperation_(model) {
    const now = new Date();

    if (this.analytics_.has(model)) {
      const entry = this.analytics_.get(model);
      entry.hits++;
      entry.lastHit = now;
    } else {
      const entry = {
        key: model,
        hits: 1,
        lastHit: now,
      };

      if (this.analytics_.size >= this.maxAnalyticsEntries_) {
        this.removeLeastRecentlyUsed_();
      }

      this.analytics_.set(model, entry);
    }
  }

  /**
   * Removes the least recently used entry from analytics.
   * @private
   */
  removeLeastRecentlyUsed_() {
    let oldestKey = null;
    let oldestTime = null;

    for (const [key, entry] of this.analytics_) {
      if (!oldestTime || entry.lastHit < oldestTime) {
        oldestTime = entry.lastHit;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.analytics_.delete(oldestKey);
    }
  }
}

module.exports = AIServiceBase;