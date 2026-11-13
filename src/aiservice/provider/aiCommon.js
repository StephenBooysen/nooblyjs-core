/**
 * @fileoverview AI provider backed by the shared AI module (feature 02).
 *
 * `src/aiservice/common` is an ES module with no dependencies. This CommonJS
 * provider loads it once with a dynamic import and gives services the same
 * methods as the older providers (`prompt`), plus `complete`, `stream`,
 * `streamToResponse` and `generateObject`.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ClientError } = require('../../shared/utils/httpErrors');

/** Provider names the factory accepts for this class, mapped to catalogue ids. */
const CATALOGUE_IDS = Object.freeze({
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  ollama: 'ollama',
  'openai-compatible': 'openai-compatible',
  bedrock: 'bedrock',
  vertex: 'vertex',
  azure: 'azure',
  mock: 'mock'
});

let commonPromise = null;

/**
 * Native dynamic import. Built with `new Function` so that transpilers and
 * Jest do not rewrite it; Node loads the ESM package as usual.
 * @type {function(string): Promise<Object>}
 */
const nativeImport = new Function('specifier', 'return import(specifier)');

/**
 * Loads the shared AI module once.
 * @return {Promise<Object>} The module's exports
 */
function loadCommon() {
  if (!commonPromise) {
    const entry = path.join(__dirname, '..', 'common', 'index.js');
    commonPromise = nativeImport(pathToFileURL(entry).href);
  }
  return commonPromise;
}

class AICommon {
  /**
   * @param {Object} options Provider options
   * @param {string=} options.model Model id
   * @param {string=} options.apiKey API key (otherwise read from the environment)
   * @param {string=} options.baseUrl Endpoint override
   * @param {Array<*>=} options.script Replies for the mock provider
   * @param {Object=} options.budgets Limits: maxTokensPerRequest, maxCostPerDay
   * @param {Object=} options.embeddings Where embed() goes: `{ provider, model, apiKey, baseUrl }`.
   *   Defaults to this instance's provider; set it for providers without embeddings (anthropic, azure).
   * @param {EventEmitter=} eventEmitter Event sink
   * @param {Object=} extra
   * @param {string=} extra.providerId Catalogue id, defaults to 'anthropic'
   */
  constructor(options = {}, eventEmitter = null, { providerId = 'anthropic' } = {}) {
    if (!CATALOGUE_IDS[providerId]) {
      throw new Error(`Unknown AI provider for the shared module: ${providerId}`);
    }
    this.providerId_ = CATALOGUE_IDS[providerId];
    this.settings = {
      model: options.model || (this.providerId_ === 'mock' ? 'mock' : undefined),
      description: 'Shared AI module provider'
    };
    this.options_ = options;
    this.eventEmitter_ = eventEmitter;
    this.budgets_ = { maxTokensPerRequest: 8192, maxCostPerDay: Infinity, ...(options.budgets || {}) };
    this.spentToday_ = { day: '', cost: 0 };
    this.provider_ = null;
    this.embedder_ = null;
  }

  /**
   * Creates the underlying provider on first use.
   * @private
   * @return {Promise<Object>} A shared-module provider
   */
  async provider() {
    if (this.provider_) return this.provider_;
    const common = await loadCommon();
    if (this.providerId_ === 'mock') {
      this.provider_ = common.createMockProvider(this.options_.script || [{ text: 'ok' }]);
    } else {
      this.provider_ = common.createProvider(this.providerId_, {
        apiKey: this.options_.apiKey,
        baseUrl: this.options_.baseUrl,
        model: this.settings.model
      });
    }
    return this.provider_;
  }

  /**
   * Refuses a request that would exceed the token limit or today's cost budget.
   * @private
   * @param {number} maxTokens Requested output tokens
   */
  checkBudget_(maxTokens) {
    if (maxTokens > this.budgets_.maxTokensPerRequest) {
      throw new ClientError(429, `maxTokens ${maxTokens} is above the limit of ${this.budgets_.maxTokensPerRequest}`);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (this.spentToday_.day !== today) this.spentToday_ = { day: today, cost: 0 };
    if (this.spentToday_.cost >= this.budgets_.maxCostPerDay) {
      throw new ClientError(429, 'The daily cost budget for this AI instance is used up');
    }
  }

  /**
   * Adds a call's cost to today's total and reports usage to listeners.
   * @private
   */
  recordUsage_(reply, common) {
    const cost = common.costOf ? common.costOf(reply.model || this.settings.model, reply.usage) : 0;
    const numeric = typeof cost === 'number' ? cost : (cost?.total ?? 0);
    this.spentToday_.cost += numeric || 0;
    this.eventEmitter_?.emit?.('ai:usage', { provider: this.providerId_, model: reply.model, usage: reply.usage, cost: numeric || 0 });
    return numeric || 0;
  }

  /**
   * Sends a prompt. Returns the same shape as the older providers:
   * `{ content, usage, model, provider }`.
   * @param {string} prompt User prompt
   * @param {Object=} options `maxTokens`, `system`
   * @return {Promise<{content: string, usage: Object, model: ?string, provider: string}>} Reply
   */
  async prompt(prompt, options = {}) {
    const reply = await this.complete({
      messages: [{ role: 'user', content: String(prompt) }],
      system: options.system,
      maxTokens: options.maxTokens
    });
    return { content: reply.text, usage: reply.usage, model: reply.model || this.settings.model, provider: this.providerId_ };
  }

  /**
   * Runs one request and waits for the whole reply.
   * @param {{messages: Array<Object>, system?: string, tools?: Array<Object>, maxTokens?: number}} request
   * @return {Promise<{text: string, toolCalls: Array<Object>, stopReason: ?string, usage: Object, model: ?string}>} Reply
   */
  async complete(request) {
    const common = await loadCommon();
    const maxTokens = request.maxTokens ?? 1024;
    this.checkBudget_(maxTokens);
    const provider = await this.provider();
    const reply = await common.complete(provider, {
      model: request.model || this.settings.model,
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      maxTokens
    });
    reply.cost = this.recordUsage_(reply, common);
    return reply;
  }

  /**
   * Streams events from one request.
   * @param {Object} request Same as complete()
   * @return {AsyncGenerator<Object>} Shared-module events (text_delta, message, ...)
   */
  async *stream(request) {
    this.checkBudget_(request.maxTokens ?? 1024);
    const provider = await this.provider();
    const events = provider.stream({
      model: request.model || this.settings.model,
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      maxTokens: request.maxTokens ?? 1024
    });
    for await (const event of events) {
      yield event;
    }
  }

  /**
   * Streams a reply to an HTTP response as server-sent events, without buffering.
   * @param {import('node:http').ServerResponse} res Response to write to
   * @param {Object} request Same as complete()
   * @return {Promise<void>}
   */
  async streamToResponse(res, request) {
    const common = await loadCommon();
    const sse = common.openSSE(res);
    try {
      for await (const event of this.stream(request)) {
        if (event.type === common.EVENT.TEXT_DELTA) sse.send('text', { text: event.text });
        else if (event.type === common.EVENT.MESSAGE) {
          const message = event.message || {};
          const model = message.model || request.model || this.settings.model;
          const usage = common.normalizeUsage(message.usage);
          const cost = this.recordUsage_({ model, usage }, common);
          sse.send('done', { stopReason: message.stop_reason, model, usage, cost });
        }
      }
    } catch (err) {
      sse.send('error', { message: 'The model request failed' });
      this.eventEmitter_?.emit?.('ai:stream-error', { provider: this.providerId_, error: err.message });
    }
    res.end();
  }

  /**
   * Asks for JSON and checks it against a small schema of required keys and types.
   * @param {{messages: Array<Object>, schema: {type: 'object', required?: string[], properties?: Object}}} request
   * @return {Promise<Object>} The parsed object
   * @throws {ClientError} 422 when the reply is not valid JSON for the schema
   */
  async generateObject(request) {
    const schema = request.schema || {};
    const instruction = `Reply with only a JSON object matching this schema: ${JSON.stringify(schema)}`;
    const reply = await this.complete({
      ...request,
      system: [request.system, instruction].filter(Boolean).join('\n\n')
    });
    let value;
    try {
      value = JSON.parse(reply.text.trim().replace(/^```(json)?\s*|\s*```$/g, ''));
    } catch (_err) {
      throw new ClientError(422, 'The model did not return valid JSON');
    }
    const problems = checkAgainstSchema(value, schema);
    if (problems.length) {
      throw new ClientError(422, `The model's JSON does not match the schema: ${problems.join('; ')}`);
    }
    return value;
  }

  /**
   * Creates the embedder on first use: `options.embeddings.provider`, else this instance's provider.
   * @private
   * @return {Promise<Object>} A shared-module embedder
   */
  async embedder() {
    if (this.embedder_) return this.embedder_;
    const common = await loadCommon();
    const config = this.options_.embeddings || {};
    const id = config.provider || this.providerId_;
    const sameProvider = id === this.providerId_;
    this.embedder_ = common.createEmbedder(id, {
      apiKey: config.apiKey || (sameProvider ? this.options_.apiKey : undefined),
      baseUrl: config.baseUrl || (sameProvider ? this.options_.baseUrl : undefined),
      model: config.model
    });
    return this.embedder_;
  }

  /**
   * Embeds one text or a list of texts.
   *
   * Returns the vectors in input order, plus the model and usage. The searching
   * service's `aiservice` embeddings backend reads `vectors`.
   *
   * @param {string|Array<string>} texts Text or texts to embed
   * @param {{model?: string, dimensions?: number}=} options Embedding model and size
   * @return {Promise<{vectors: Array<Array<number>>, model: string, usage: {input_tokens: number}}>} Vectors
   * @throws {ClientError} 400 when the provider has no embeddings endpoint or the input is invalid
   * @example
   * const { vectors } = await ai.embed(['how do I reset my password'], { dimensions: 768 });
   */
  async embed(texts, options = {}) {
    const embedder = await this.embedder();
    let result;
    try {
      result = await embedder.embed(texts, { model: options.model, dimensions: options.dimensions });
    } catch (err) {
      if (err && err.name === 'ApiError' && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && err.status !== 429) {
        throw new ClientError(400, err.message);
      }
      throw err;
    }
    this.eventEmitter_?.emit?.('ai:usage', { provider: embedder.name, model: result.model, usage: result.usage, cost: 0, kind: 'embed' });
    return result;
  }

  /**
   * Models this provider can use, from the shared catalogue. Cloud hosts serve
   * the Anthropic models; the mock answers as `mock`.
   * @return {Promise<Array<{id: string, label: string, contextWindow: ?number, pricing: ?Object}>>} Models
   */
  async listModels() {
    const common = await loadCommon();
    if (this.providerId_ === 'mock') return [{ id: 'mock', label: 'Mock', contextWindow: null, pricing: null }];
    const catalogue = ['bedrock', 'vertex', 'azure'].includes(this.providerId_) ? 'anthropic' : this.providerId_;
    return common.modelsFor(catalogue).map((m) => ({
      id: m.id,
      label: m.label,
      contextWindow: m.contextWindow ?? null,
      pricing: m.pricing ?? null
    }));
  }

  /** @return {Object} Settings (no secrets) */
  getSettings() {
    return { ...this.settings, provider: this.providerId_ };
  }
}

/**
 * Checks required keys and simple types of a JSON value.
 * @param {*} value Parsed JSON
 * @param {{required?: string[], properties?: Object<string, {type: string}>}} schema Minimal schema
 * @return {Array<string>} Problems, empty when valid
 */
function checkAgainstSchema(value, schema) {
  const problems = [];
  if (schema.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    return ['expected an object'];
  }
  for (const key of schema.required || []) {
    if (!(key in value)) problems.push(`missing "${key}"`);
  }
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    if (!(key in value) || !spec.type) continue;
    const actual = Array.isArray(value[key]) ? 'array' : typeof value[key];
    if (actual !== spec.type) problems.push(`"${key}" should be ${spec.type}`);
  }
  return problems;
}

module.exports = AICommon;
module.exports.loadCommon = loadCommon;
module.exports.checkAgainstSchema = checkAgainstSchema;
