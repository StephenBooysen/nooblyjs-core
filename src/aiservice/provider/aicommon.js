/**
 * @fileoverview AI Service v2 provider on nooblyjs-ai-common (feature 02).
 *
 * One provider class for every model API in the common catalogue: Anthropic,
 * OpenAI, OpenAI-compatible servers, Ollama, Gemini, Grok, DeepSeek, AWS
 * Bedrock, Google Vertex AI, Azure and a scripted mock. It keeps the legacy
 * `prompt()` contract and adds `complete`, `stream`, `streamToResponse`,
 * `generateObject` and `embed`, with prices from the common model catalogue
 * and per-instance budgets.
 *
 * @example
 * const ai = serviceRegistry.aiservice('anthropic', { model: 'claude-sonnet-5-5' });
 * const { text, usage, cost } = await ai.complete({ messages: [{ role: 'user', content: 'Hi' }] });
 * for await (const event of ai.stream({ messages })) { ... }
 * const vectors = await ai.embed(['one', 'two']);
 */

'use strict';

const AIServiceBase = require('./aibase');
const { loadCommon } = require('../modules/commonBridge');
const { ClientError } = require('../../shared/utils/httpErrors');
const { validateSchema } = require('../../shared/utils/jsonSchema');

/**
 * Registry provider names mapped to the common catalogue's provider ids.
 * @const {!Object<string, string>}
 */
const PROVIDER_IDS = Object.freeze({
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  chatgpt: 'openai',
  'openai-compatible': 'openai',
  ollama: 'ollama',
  gemini: 'gemini',
  grok: 'grok',
  deepseek: 'deepseek',
  bedrock: 'bedrock',
  vertex: 'vertex',
  azure: 'azure',
  mock: 'mock'
});

/** Default model when neither the options nor the catalogue name one. */
const FALLBACK_MODELS = Object.freeze({
  bedrock: 'claude-sonnet-5-5',
  vertex: 'claude-sonnet-5-5',
  azure: 'claude-sonnet-5-5',
  mock: 'mock-model'
});

/** Which embeddings backend serves each provider. */
const EMBED_IDS = Object.freeze({
  anthropic: 'anthropic',
  openai: 'openai',
  ollama: 'ollama',
  gemini: 'gemini',
  bedrock: 'bedrock',
  vertex: 'vertex',
  mock: 'mock'
});

/**
 * AI provider built on nooblyjs-ai-common.
 * @class
 * @extends {AIServiceBase}
 */
class AICommon extends AIServiceBase {
  /**
   * @param {Object} options - Configuration
   * @param {string} options.providerName - Registry provider name (anthropic, openai, mock, ...)
   * @param {string=} options.model - Model id (defaults to the catalogue's default for the provider)
   * @param {string=} options.apiKey - API key (else the provider's environment variable)
   * @param {string=} options.baseUrl - Server address (needed for openai-compatible)
   * @param {number=} options.maxTokens - Default max output tokens (1000)
   * @param {number=} options.temperature - Default temperature
   * @param {string=} options.system - Default system prompt
   * @param {number=} options.maxCostPerDay - Budget in USD per UTC day; over it calls get 429
   * @param {number=} options.maxTokensPerRequest - Cap on input estimate + max output tokens
   * @param {string=} options.embeddingModel - Model for embed()
   * @param {string=} options.embeddingProvider - Embeddings backend when it differs from the chat provider
   * @param {Array=} options.script - Replies for the mock provider
   * @param {Object=} options.provider - A ready provider object ({ name, stream }) to use as-is
   * @param {EventEmitter=} eventEmitter - Event emitter
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);
    this.providerName_ = options.providerName || 'anthropic';
    this.providerId_ = PROVIDER_IDS[this.providerName_];
    if (!this.providerId_) {
      throw new Error(`Unsupported AI provider type: ${this.providerName_}`);
    }
    if (this.providerName_ === 'openai-compatible' && !options.baseUrl) {
      throw new Error('openai-compatible needs a baseUrl');
    }
    this.options_ = options;
    this.provider_ = options.provider || null;
    this.providerPromise_ = null;
    this.spend_ = { day: '', cost: 0 };

    // Only behaviour can be changed at runtime: never the key or the address,
    // which would let a settings call redirect credentials (as in feature 15).
    this.settings = {
      description: 'AI Service v2 on nooblyjs-ai-common: one API for every model provider.',
      list: [
        { setting: 'model', type: 'string', values: [options.model || ''] },
        { setting: 'maxtokens', type: 'int', values: ['1000'] },
        { setting: 'temperature', type: 'number', values: ['0.7'] },
        { setting: 'maxCostPerDay', type: 'number', values: ['0 = no limit'] },
        { setting: 'maxTokensPerRequest', type: 'int', values: ['0 = no limit'] }
      ],
      model: options.model || null,
      maxtokens: Number(options.maxTokens || options.maxtokens) || 1000,
      temperature: options.temperature,
      maxCostPerDay: Number(options.maxCostPerDay) || 0,
      maxTokensPerRequest: Number(options.maxTokensPerRequest) || 0
    };
  }

  /** @return {!Promise<Object>} Current settings. */
  async getSettings() {
    return this.settings;
  }

  /**
   * Applies runtime settings (model, maxtokens, temperature, budgets only).
   * @param {!Object} input - New values
   */
  async saveSettings(input = {}) {
    const numeric = { maxtokens: true, temperature: true, maxCostPerDay: true, maxTokensPerRequest: true };
    for (const { setting } of this.settings.list) {
      if (input[setting] === undefined || input[setting] === null || input[setting] === '') continue;
      const value = numeric[setting] ? Number(input[setting]) : String(input[setting]);
      if (numeric[setting] && !Number.isFinite(value)) {
        throw new ClientError(400, `Setting "${setting}" must be a number`);
      }
      this.settings[setting] = value;
      this.logger?.info?.(`[${this.constructor.name}] Setting changed: ${setting}`, { setting });
    }
  }

  /** @return {string} Registry provider name. */
  get providerName() {
    return this.providerName_;
  }

  /**
   * The model used when a request names none.
   * @return {!Promise<string>}
   */
  async defaultModel() {
    if (this.settings.model) return this.settings.model;
    const common = await loadCommon();
    return (common.PROVIDERS[this.providerId_] && common.PROVIDERS[this.providerId_].defaultModel)
      || FALLBACK_MODELS[this.providerId_]
      || 'default';
  }

  /**
   * Creates the common provider on first use.
   * @return {!Promise<{name: string, stream: Function}>}
   * @private
   */
  async getProvider_() {
    if (this.provider_) return this.provider_;
    if (!this.providerPromise_) {
      this.providerPromise_ = (async () => {
        const common = await loadCommon();
        if (this.providerId_ === 'mock') {
          return common.createMockProvider(this.options_.script || [{ text: 'mock reply' }]);
        }
        const { apiKey, apikey, baseUrl, providerOptions = {} } = this.options_;
        return common.createProvider(this.providerId_, {
          ...providerOptions,
          apiKey: apiKey || apikey,
          baseUrl,
          ...(this.providerName_ === 'openai-compatible' ? { api: 'openai-chat' } : {})
        });
      })().then((provider) => {
        this.provider_ = provider;
        return provider;
      }, (error) => {
        this.providerPromise_ = null;
        throw error;
      });
    }
    return this.providerPromise_;
  }

  /**
   * Normalises a request: default model, max tokens, system and temperature,
   * and a string `prompt` turned into one user message.
   * @param {!Object} request - Caller's request
   * @return {!Promise<Object>}
   * @private
   */
  async buildRequest_(request = {}) {
    const { prompt, signal, username, ...rest } = request;
    let messages = rest.messages;
    if (!Array.isArray(messages)) {
      if (typeof prompt !== 'string' || prompt === '') {
        throw new ClientError(400, 'A request needs messages or a prompt');
      }
      messages = [{ role: 'user', content: prompt }];
    }
    const built = {
      ...rest,
      model: rest.model || await this.defaultModel(),
      messages,
      maxTokens: Number(rest.maxTokens) || this.settings.maxtokens
    };
    if (built.system === undefined && this.options_.system) built.system = this.options_.system;
    if (built.temperature === undefined && this.settings.temperature !== undefined) {
      built.temperature = Number(this.settings.temperature);
    }
    return built;
  }

  /**
   * Refuses a request over the per-request token cap or the daily budget.
   * @param {!Object} request - Built request
   * @throws {ClientError} 429 when over a limit
   * @private
   */
  async checkBudget_(request) {
    const { maxTokensPerRequest, maxCostPerDay } = this.settings;
    if (maxTokensPerRequest > 0) {
      const common = await loadCommon();
      const estimate = common.estimateTokens({ system: request.system, messages: request.messages }) + request.maxTokens;
      if (estimate > maxTokensPerRequest) {
        this.eventEmitter_?.emit('ai:budget-exceeded', { instanceName: this.instanceName_, limit: 'maxTokensPerRequest', estimate });
        throw new ClientError(429, `This request needs about ${estimate} tokens; the limit is ${maxTokensPerRequest}`, { code: 'AI_TOKEN_LIMIT' });
      }
    }
    if (maxCostPerDay > 0 && this.spentToday_() >= maxCostPerDay) {
      this.eventEmitter_?.emit('ai:budget-exceeded', { instanceName: this.instanceName_, limit: 'maxCostPerDay', spent: this.spend_.cost });
      throw new ClientError(429, `The daily AI budget of $${maxCostPerDay} is used up`, { code: 'AI_DAILY_BUDGET' });
    }
  }

  /**
   * Spend so far in the current UTC day.
   * @return {number} USD
   * @private
   */
  spentToday_() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.spend_.day !== day) this.spend_ = { day, cost: 0 };
    return this.spend_.cost;
  }

  /**
   * Records usage and cost for a finished reply, and emits `ai:usage`.
   * @param {!Object} usage - Normalised usage (input_tokens, output_tokens, ...)
   * @param {string} model - Model that answered
   * @return {!Promise<number>} Cost in USD
   * @private
   */
  async recordUsage_(usage, model) {
    const common = await loadCommon();
    const cost = common.costOf(model, usage);
    this.spentToday_();
    this.spend_.cost += cost;
    const legacy = {
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheWriteTokens: usage.cache_creation_input_tokens || 0
    };
    this.lastCost_ = cost;
    await this.trackUsage_(legacy, model, this.providerName_);
    return cost;
  }

  /**
   * Cost from the common catalogue (overrides the legacy flat rates).
   * @return {number} USD
   * @protected
   */
  estimateCost_() {
    return this.lastCost_ || 0;
  }

  /**
   * One request, whole reply.
   *
   * @param {!Object} request - `{ messages | prompt, system?, tools?, maxTokens?, temperature?, model?, signal? }`
   * @return {!Promise<{text: string, toolCalls: !Array, message: Object, stopReason: ?string, usage: Object, cost: number, model: string}>}
   */
  async complete(request = {}) {
    const built = await this.buildRequest_(request);
    await this.checkBudget_(built);
    const common = await loadCommon();
    const provider = await this.getProvider_();
    try {
      const reply = await common.complete(provider, built, { signal: request.signal });
      const model = reply.model || built.model;
      const cost = await this.recordUsage_(reply.usage, model);
      return { ...reply, model, cost };
    } catch (error) {
      this.eventEmitter_?.emit('ai:error', { error: error.message, provider: this.providerName_ });
      throw error;
    }
  }

  /**
   * Streams a reply as events: `message_start`, `text_delta`,
   * `thinking_delta`, `retry`, and finally `message` (the whole reply), then
   * `usage` with the cost.
   *
   * @param {!Object} request - As for complete()
   * @return {!AsyncGenerator<Object>}
   */
  async *stream(request = {}) {
    const built = await this.buildRequest_(request);
    await this.checkBudget_(built);
    const common = await loadCommon();
    const provider = await this.getProvider_();
    let message = null;
    try {
      for await (const event of provider.stream(built, { signal: request.signal })) {
        if (event.type === common.EVENT.MESSAGE) message = event.message;
        yield event;
      }
    } catch (error) {
      this.eventEmitter_?.emit('ai:error', { error: error.message, provider: this.providerName_ });
      throw error;
    }
    if (message) {
      const usage = common.normalizeUsage(message.usage);
      const model = message.model || built.model;
      const cost = await this.recordUsage_(usage, model);
      yield { type: 'usage', usage, cost, model };
    }
  }

  /**
   * Streams a reply to a browser as Server-Sent Events, unbuffered. Each
   * stream event is sent with its type as the SSE event name; a failure is
   * sent as an `error` event with a client-safe message.
   *
   * @param {!http.ServerResponse} res - Express response
   * @param {!Object} request - As for complete()
   * @return {!Promise<void>} Resolves when the response has ended
   */
  async streamToResponse(res, request = {}) {
    const common = await loadCommon();
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const sse = common.openSSE(res, { heartbeatMs: 15000 });
    try {
      for await (const event of this.stream({ ...request, signal: controller.signal })) {
        sse.send(event.type, event);
      }
      sse.send('done', {});
    } catch (error) {
      if (!controller.signal.aborted) {
        const safe = error instanceof ClientError ? error.message : 'The model request failed';
        sse.send('error', { message: safe, status: error.statusCode || error.status || 500 });
      }
    } finally {
      sse.close();
    }
  }

  /**
   * Asks for JSON matching a schema and validates the reply. On invalid
   * output the model is told what was wrong and asked again (`retries`, 1).
   *
   * @param {!Object} request - complete() request plus `schema` (JSON Schema) and `retries`
   * @return {!Promise<{object: *, usage: Object, cost: number, model: string}>}
   * @throws {ClientError} 422 when the model never produced valid JSON
   */
  async generateObject(request = {}) {
    const { schema, retries = 1, ...rest } = request;
    if (!schema || typeof schema !== 'object') {
      throw new ClientError(400, 'generateObject needs a JSON schema');
    }
    const instruction = 'Reply with one JSON value only, no prose and no code fences. It must match this JSON Schema:\n'
      + JSON.stringify(schema);
    const system = [rest.system, instruction].filter(Boolean).join('\n\n');
    let messages = (await this.buildRequest_(rest)).messages;
    let lastProblem = '';
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const reply = await this.complete({ ...rest, system, messages });
      const parsed = parseJsonReply(reply.text);
      const problems = parsed.ok ? validateSchema(schema, parsed.value) : [{ path: '$', message: parsed.error }];
      if (problems.length === 0) {
        return { object: parsed.value, usage: reply.usage, cost: reply.cost, model: reply.model };
      }
      lastProblem = problems.map((p) => `${p.path}: ${p.message}`).join('; ');
      messages = [
        ...messages,
        { role: 'assistant', content: reply.text || '(empty)' },
        { role: 'user', content: `That reply was not valid: ${lastProblem}. Reply again with JSON only.` }
      ];
    }
    throw new ClientError(422, `The model did not return valid JSON for the schema (${lastProblem})`, { code: 'AI_INVALID_OBJECT' });
  }

  /**
   * Embeds text. Uses `embeddingProvider` when set, else the chat provider's
   * own embeddings API (Anthropic has none and says so).
   *
   * @param {string|!Array<string>} input - Text or texts
   * @param {Object=} options - `{ dimensions, model }`
   * @return {!Promise<!Array<!Array<number>>>} One vector per input
   */
  async embed(input, options = {}) {
    const common = await loadCommon();
    const backend = this.options_.embeddingProvider
      || (this.providerName_ === 'openai-compatible' ? 'openai-compatible' : EMBED_IDS[this.providerId_]);
    if (!backend || backend === 'anthropic') {
      throw new ClientError(400, `The ${this.providerName_} provider has no embeddings API. `
        + 'Set embeddingProvider to openai, gemini, ollama, bedrock or vertex (or mock in tests).', { code: 'AI_NO_EMBEDDINGS' });
    }
    const sameBackend = !this.options_.embeddingProvider;
    const result = await common.embed(backend, input, {
      model: options.model || this.options_.embeddingModel,
      dimensions: options.dimensions,
      apiKey: sameBackend ? (this.options_.apiKey || this.options_.apikey) : this.options_.embeddingApiKey,
      baseUrl: sameBackend ? this.options_.baseUrl : this.options_.embeddingBaseUrl,
      signal: options.signal
    });
    this.eventEmitter_?.emit('ai:embed', {
      instanceName: this.instanceName_,
      provider: backend,
      model: result.model,
      count: result.vectors.length,
      usage: result.usage
    });
    return result.vectors;
  }

  /**
   * Legacy single-prompt call; returns the pre-v2 shape.
   *
   * @param {string} prompt - The prompt
   * @param {Object=} options - `{ maxTokens, temperature, system, model, username }`
   * @return {!Promise<{content: string, usage: Object, model: string, provider: string}>}
   */
  async prompt(prompt, options = {}) {
    const reply = await this.complete({
      prompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      system: options.system,
      model: options.model
    });
    const result = {
      content: reply.text,
      usage: {
        promptTokens: reply.usage.input_tokens || 0,
        completionTokens: reply.usage.output_tokens || 0,
        totalTokens: (reply.usage.input_tokens || 0) + (reply.usage.output_tokens || 0)
      },
      model: reply.model,
      provider: this.providerName_,
      cost: reply.cost
    };
    this.emitPromptComplete_(prompt, result, options);
    return result;
  }

  /**
   * Models from the common catalogue for this provider.
   * @return {!Promise<!Array<{id: string, name: string, contextWindow: ?number, pricing: ?Object}>>}
   */
  async listModels() {
    const common = await loadCommon();
    return common.modelsFor(this.providerId_).map((m) => ({
      id: m.id,
      name: m.label || m.id,
      contextWindow: m.contextWindow || null,
      pricing: m.pricing || null
    }));
  }
}

/**
 * Parses a model's JSON reply, tolerating code fences and surrounding prose.
 * @param {string} text - Reply text
 * @return {{ok: boolean, value?: *, error?: string}}
 */
function parseJsonReply(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced ? fenced[1] : raw];
  const start = raw.search(/[[{]/);
  if (start > 0) candidates.push(raw.slice(start));
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate.trim()) };
    } catch (_) {
      // try the next shape
    }
  }
  return { ok: false, error: 'not valid JSON' };
}

AICommon.PROVIDER_IDS = PROVIDER_IDS;
AICommon.parseJsonReply = parseJsonReply;

module.exports = AICommon;
