'use strict';

/**
 * @fileoverview AI Service v2 on nooblyjs-ai-common (feature 02), against the
 * scripted mock provider: complete, stream, SSE to a browser, structured
 * output, embeddings, budgets, the legacy prompt() shape, the factory's
 * provider names and the REST endpoints.
 */

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');

const createAIService = require('../../../src/aiservice');
const AICommon = require('../../../src/aiservice/provider/aicommon');
const { permissionFor } = require('../../../src/authservice/policy/routePermissions');

const mock = (script, extra = {}) => new AICommon({ providerName: 'mock', script, ...extra }, new EventEmitter());

describe('AICommon provider', () => {
  it('complete() returns text, usage, cost and model', async () => {
    const ai = mock([{ text: 'Hello there', usage: { input_tokens: 10, output_tokens: 5 } }], { model: 'claude-sonnet-5-5' });
    const reply = await ai.complete({ system: 'Be brief', messages: [{ role: 'user', content: 'Hi' }] });
    expect(reply.text).toBe('Hello there');
    expect(reply.usage).toEqual(expect.objectContaining({ input_tokens: 10, output_tokens: 5 }));
    // Sonnet 5.5: $2 in, $10 out per million tokens.
    expect(reply.cost).toBeCloseTo(10 * 2e-6 + 5 * 10e-6, 12);
    expect(reply.model).toBe('claude-sonnet-5-5');
  });

  it('passes system, tools and maxTokens to the provider and returns tool calls', async () => {
    const ai = mock([{ text: 'Let me check', tools: [{ name: 'lookup', input: { id: 1 } }] }]);
    const tools = [{ name: 'lookup', description: 'Look up', input_schema: { type: 'object' } }];
    const reply = await ai.complete({ prompt: 'Find 1', system: 'sys', tools, maxTokens: 50 });
    expect(reply.toolCalls).toEqual([expect.objectContaining({ name: 'lookup', input: { id: 1 } })]);
    expect(reply.stopReason).toBe('tool_use');
    const provider = await ai.getProvider_();
    expect(provider.requests[0]).toEqual(expect.objectContaining({ system: 'sys', tools, maxTokens: 50 }));
  });

  it('stream() yields deltas, the message, then usage', async () => {
    const ai = mock([{ text: 'abcdefg' }]);
    const types = [];
    let text = '';
    for await (const event of ai.stream({ prompt: 'go' })) {
      types.push(event.type);
      if (event.type === 'text_delta') text += event.text;
    }
    expect(text).toBe('abcdefg');
    expect(types[0]).toBe('message_start');
    expect(types.slice(-2)).toEqual(['message', 'usage']);
  });

  it('generateObject() validates against the schema and retries once with the problem', async () => {
    const schema = { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string' }, age: { type: 'integer' } } };
    const ai = mock([{ text: '{"name":"Ada"}' }, { text: '```json\n{"name":"Ada","age":36}\n```' }]);
    const result = await ai.generateObject({ prompt: 'Who?', schema });
    expect(result.object).toEqual({ name: 'Ada', age: 36 });
    const provider = await ai.getProvider_();
    expect(provider.requests[1].messages.at(-1).content).toMatch(/missing required "age"/);
    expect(provider.requests[0].system).toMatch(/JSON Schema/);
  });

  it('generateObject() gives up with 422 after the retries', async () => {
    const ai = mock([{ text: 'no json here' }, { text: 'still none' }]);
    await expect(ai.generateObject({ prompt: 'x', schema: { type: 'object' } })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('embed() returns one vector per input; Anthropic says it has none', async () => {
    const vectors = await mock([]).embed(['a b', 'c'], { dimensions: 8 });
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(8);
    const claude = new AICommon({ providerName: 'anthropic', apiKey: 'x' });
    await expect(claude.embed('x')).rejects.toMatchObject({ statusCode: 400, code: 'AI_NO_EMBEDDINGS' });
    const withBackend = new AICommon({ providerName: 'anthropic', apiKey: 'x', embeddingProvider: 'mock' });
    await expect(withBackend.embed('x')).resolves.toHaveLength(1);
  });

  it('enforces maxTokensPerRequest and maxCostPerDay with 429', async () => {
    const capped = mock([{ text: 'x' }], { maxTokensPerRequest: 100 });
    await expect(capped.complete({ prompt: 'hi', maxTokens: 500 })).rejects.toMatchObject({ statusCode: 429, code: 'AI_TOKEN_LIMIT' });

    const budget = mock([{ text: 'one' }, { text: 'two' }], { model: 'claude-sonnet-5-5', maxCostPerDay: 0.00005 });
    await budget.complete({ prompt: 'a' });
    await expect(budget.complete({ prompt: 'b' })).rejects.toMatchObject({ statusCode: 429, code: 'AI_DAILY_BUDGET' });
  });

  it('prompt() keeps the legacy shape and emits ai:prompt:complete and ai:usage', async () => {
    const events = new EventEmitter();
    const ai = new AICommon({ providerName: 'mock', script: [{ text: 'legacy' }] }, events);
    const seen = [];
    events.on('ai:prompt:complete', () => seen.push('prompt'));
    events.on('ai:usage', () => seen.push('usage'));
    const result = await ai.prompt('hello', { maxTokens: 20 });
    expect(result).toEqual(expect.objectContaining({
      content: 'legacy',
      provider: 'mock',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    }));
    expect(seen.sort()).toEqual(['prompt', 'usage']);
  });

  it('runtime settings cannot change the key or address', async () => {
    const ai = mock([]);
    await ai.saveSettings({ model: 'other', maxtokens: '200', apiKey: 'stolen', baseUrl: 'http://evil' });
    const settings = await ai.getSettings();
    expect(settings.model).toBe('other');
    expect(settings.maxtokens).toBe(200);
    expect(settings.apiKey).toBeUndefined();
    expect(settings.baseUrl).toBeUndefined();
    await expect(ai.saveSettings({ maxtokens: 'lots' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('parses JSON replies wrapped in prose or fences', () => {
    expect(AICommon.parseJsonReply('Sure: {"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(AICommon.parseJsonReply('```\n[1,2]\n```')).toEqual({ ok: true, value: [1, 2] });
    expect(AICommon.parseJsonReply('nope').ok).toBe(false);
  });
});

describe('factory provider names', () => {
  const make = (type, opts = {}) => createAIService(type, { ...opts, dependencies: {} }, new EventEmitter());

  it('serves v2 names with AICommon', () => {
    for (const name of ['anthropic', 'mock', 'bedrock', 'vertex', 'azure', 'grok', 'deepseek']) {
      expect(make(name)).toBeInstanceOf(AICommon);
    }
    expect(make('openai-compatible', { baseUrl: 'http://localhost:1234/v1' })).toBeInstanceOf(AICommon);
    expect(() => make('openai-compatible')).toThrow('baseUrl');
  });

  it('keeps legacy classes for the pre-v2 names unless legacy: false', () => {
    expect(make('claude', { apiKey: 'k' })).not.toBeInstanceOf(AICommon);
    const v2 = make('claude', { legacy: false });
    expect(v2).toBeInstanceOf(AICommon);
    expect(v2.providerName).toBe('claude');
  });
});

describe('REST endpoints', () => {
  const build = (svc) => {
    const app = express();
    app.use(express.json());
    require('../../../src/aiservice/routes')({ 'express-app': app }, new EventEmitter(), svc);
    return app;
  };

  it('POST /complete returns the reply', async () => {
    const app = build(mock([{ text: 'done' }]));
    const res = await request(app).post('/services/ai/api/complete').send({ messages: [{ role: 'user', content: 'x' }] }).expect(200);
    expect(res.body).toEqual(expect.objectContaining({ text: 'done', stopReason: 'end_turn' }));
    await request(app).post('/services/ai/api/complete').send({}).expect(400);
    await request(app).post('/services/ai/api/complete').send({ prompt: 'x', maxTokens: -1 }).expect(400);
  });

  it('POST /stream answers as Server-Sent Events', async () => {
    const app = build(mock([{ text: 'streamed' }]));
    const res = await request(app).post('/services/ai/api/stream').send({ prompt: 'x' }).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toMatch(/event: text_delta/);
    expect(res.text).toMatch(/event: usage/);
    expect(res.text).toMatch(/event: done/);
  });

  it('POST /stream reports a failure as an error event with a safe message', async () => {
    const app = build(mock([new Error('secret upstream detail')]));
    const res = await request(app).post('/services/ai/api/stream').send({ prompt: 'x' }).expect(200);
    expect(res.text).toMatch(/event: error/);
    expect(res.text).not.toMatch(/secret upstream detail/);
  });

  it('POST /object and /embed', async () => {
    const app = build(mock([{ text: '{"ok":true}' }]));
    const obj = await request(app).post('/services/ai/api/object')
      .send({ prompt: 'x', schema: { type: 'object', required: ['ok'] } }).expect(200);
    expect(obj.body.object).toEqual({ ok: true });
    const emb = await request(app).post('/services/ai/api/embed').send({ input: ['a', 'b'], dimensions: 4 }).expect(200);
    expect(emb.body.vectors).toHaveLength(2);
    await request(app).post('/services/ai/api/embed').send({ input: [] }).expect(400);
  });

  it('legacy providers get 501 on the v2 endpoints', async () => {
    const legacy = { prompt: async () => ({}), getSettings: async () => ({}) };
    const res = await request(build(legacy)).post('/services/ai/api/complete').send({ prompt: 'x' }).expect(501);
    expect(res.body.code).toBe('AI_V2_REQUIRED');
  });

  it('the v2 endpoints need ai:prompt', () => {
    for (const p of ['complete', 'stream', 'object', 'embed']) {
      expect(permissionFor('POST', `/ai/api/${p}`)).toBe('ai:prompt');
      expect(permissionFor('POST', `/ai/api/second/${p}`)).toBe('ai:prompt');
    }
  });
});

describe('semantic search backend', () => {
  it('the searching EmbeddingClient runs on ai.embed()', async () => {
    const { EmbeddingClient } = require('../../../src/searching/modules/embeddings');
    const client = new EmbeddingClient({ backend: 'aiservice', aiservice: mock([]), dimensions: 16 });
    const vector = await client.embed('how do I reset my password');
    expect(vector).toHaveLength(16);
  });
});
