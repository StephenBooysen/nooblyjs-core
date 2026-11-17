/**
 * @fileoverview Unit tests for the AI service REST API.
 *
 * Mounts the AI routes on a bare Express application against stub providers
 * and exercises status, prompt (including the disabled state and username
 * resolution), analytics, models, health, settings, training-data endpoints
 * and named-instance routing.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const registerRoutes = require('../../../src/aiservice/routes');

/** Builds a stub provider with training support. */
function makeProvider(overrides = {}) {
  const docs = {};
  return {
    enabled: true,
    client_: {},
    prompt: jest.fn(async (text, opts) => ({ content: `echo: ${text}`, username: opts.username })),
    listModels: jest.fn(async () => ['model-a']),
    isRunning: jest.fn(async () => true),
    getSettings: jest.fn(async () => ({ model: 'model-a' })),
    saveSettings: jest.fn(async () => {}),
    addData: jest.fn(async (key, text) => { docs[key] = text; return { key, added: true }; }),
    getData: jest.fn(() => docs),
    removeData: jest.fn(async (key) => { if (!docs[key]) return false; delete docs[key]; return true; }),
    getTrainingStatus: jest.fn(() => ({ documents: Object.keys(docs).length })),
    ...overrides
  };
}

describe('AI service routes', () => {
  let app;
  let provider;
  let other;
  let analytics;
  let eventEmitter;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    eventEmitter = new EventEmitter();
    provider = makeProvider();
    other = makeProvider({ prompt: jest.fn(async () => ({ content: 'from other' })) });
    analytics = { getAnalytics: jest.fn(() => ({ totalPrompts: 3 })) };
    const registry = {
      listInstances: jest.fn(() => [{ instanceName: 'other', providerType: 'ollama' }]),
      getServiceInstance: jest.fn(() => other)
    };
    registerRoutes({ 'express-app': app, ServiceRegistry: registry, providerType: 'anthropic' }, eventEmitter, provider, analytics);
  });

  it('lists instances including the default', async () => {
    const res = await request(app).get('/services/ai/api/instances').expect(200);
    expect(res.body.instances.map((i) => i.name)).toEqual(['default', 'other']);
  });

  it('reports status for enabled and disabled providers', async () => {
    const res = await request(app).get('/services/ai/api/status').expect(200);
    expect(res.body).toEqual(expect.objectContaining({ enabled: true, hasApiKey: true }));
    provider.enabled = false;
    const disabled = await request(app).get('/services/ai/api/status').expect(200);
    expect(disabled.body.status).toMatch(/disabled/);
  });

  it('sends prompts and resolves the username', async () => {
    const res = await request(app).post('/services/ai/api/prompt').send({ prompt: 'hi', username: ' ada ' }).expect(200);
    expect(res.body.content).toBe('echo: hi');
    expect(provider.prompt).toHaveBeenLastCalledWith('hi', { username: 'ada' });

    await request(app).post('/services/ai/api/prompt').send({ prompt: 'hi', options: { username: 'bob', max: 5 } }).expect(200);
    expect(provider.prompt).toHaveBeenLastCalledWith('hi', { username: 'bob', max: 5 });

    await request(app).post('/services/ai/api/prompt').send({ prompt: 'hi' }).expect(200);
    expect(provider.prompt).toHaveBeenLastCalledWith('hi', { username: 'anonymous' });
  });

  it('validates prompts and handles disabled or failing providers', async () => {
    await request(app).post('/services/ai/api/prompt').send({}).expect(400);
    await request(app).post('/services/ai/api/prompt').send({ prompt: 5 }).expect(400);

    provider.prompt.mockRejectedValueOnce(new Error('upstream key leaked'));
    const failed = await request(app).post('/services/ai/api/prompt').send({ prompt: 'x' }).expect(500);
    expect(JSON.stringify(failed.body)).not.toContain('upstream key leaked');

    provider.enabled = false;
    await request(app).post('/services/ai/api/prompt').send({ prompt: 'x' }).expect(503);
  });

  it('serves analytics from the analytics module or the provider', async () => {
    const res = await request(app).get('/services/ai/api/analytics?limit=5&recentLimit=2').expect(200);
    expect(res.body.totalPrompts).toBe(3);
    expect(analytics.getAnalytics).toHaveBeenCalledWith({ limit: 5, recentLimit: 2 });

    analytics.getAnalytics.mockImplementation(() => { throw new Error('x'); });
    await request(app).get('/services/ai/api/analytics').expect(500);

    const bare = express();
    registerRoutes({ 'express-app': bare }, eventEmitter, makeProvider({ getAnalytics: () => ({ own: true }) }), null);
    const own = await request(bare).get('/services/ai/api/analytics').expect(200);
    expect(own.body).toEqual({ own: true });
    const bare2 = express();
    registerRoutes({ 'express-app': bare2 }, eventEmitter, makeProvider(), null);
    const empty = await request(bare2).get('/services/ai/api/analytics').expect(200);
    expect(empty.body).toEqual({});
  });

  it('lists models and reports health', async () => {
    const models = await request(app).get('/services/ai/api/models').expect(200);
    expect(models.body.models).toEqual(['model-a']);
    const health = await request(app).get('/services/ai/api/health').expect(200);
    expect(health.body.healthy).toBe(true);

    const bare = express();
    registerRoutes({ 'express-app': bare }, eventEmitter, makeProvider({ listModels: undefined, isRunning: undefined }), null);
    await request(bare).get('/services/ai/api/models').expect(200);
    const h = await request(bare).get('/services/ai/api/health').expect(200);
    expect(h.body.healthy).toBe(true);
  });

  it('gets and saves settings', async () => {
    const res = await request(app).get('/services/ai/api/settings').expect(200);
    expect(res.body.model).toBe('model-a');
    await request(app).post('/services/ai/api/settings').send({ model: 'b' }).expect(200);
    expect(provider.saveSettings).toHaveBeenCalledWith({ model: 'b' });
    provider.getSettings.mockRejectedValue(new Error('x'));
    await request(app).get('/services/ai/api/settings').expect(500);
  });

  it('manages training data', async () => {
    await request(app).post('/services/ai/api/train/data').send({ key: 'k1', text: 'hello' }).expect(200);
    const data = await request(app).get('/services/ai/api/train/data').expect(200);
    expect(data.body.total).toBe(1);
    const status = await request(app).get('/services/ai/api/train/status').expect(200);
    expect(status.body.supported).toBe(true);
    await request(app).delete('/services/ai/api/train/data/k1').expect(200);
    await request(app).delete('/services/ai/api/train/data/k1').expect(404);

    await request(app).post('/services/ai/api/train/data').send({ text: 'x' }).expect(400);
    await request(app).post('/services/ai/api/train/data').send({ key: 'k', text: '  ' }).expect(400);
  });

  it('returns 501 for training on providers without support', async () => {
    const bare = express();
    bare.use(express.json());
    registerRoutes({ 'express-app': bare }, eventEmitter,
      makeProvider({ addData: undefined, getData: undefined, removeData: undefined }), null);
    await request(bare).get('/services/ai/api/train/status').expect(501);
    await request(bare).get('/services/ai/api/train/data').expect(501);
    await request(bare).post('/services/ai/api/train/data').send({ key: 'k', text: 't' }).expect(501);
    await request(bare).delete('/services/ai/api/train/data/k').expect(501);
  });

  it('routes named-instance requests to that instance', async () => {
    const res = await request(app).post('/services/ai/api/other/prompt').send({ prompt: 'hi' }).expect(200);
    expect(res.body.content).toBe('from other');
    await request(app).get('/services/ai/api/other/status').expect(200);
    await request(app).get('/services/ai/api/other/analytics').expect(200);
    await request(app).get('/services/ai/api/other/models').expect(200);
    await request(app).get('/services/ai/api/other/health').expect(200);
    await request(app).get('/services/ai/api/other/settings').expect(200);
    await request(app).post('/services/ai/api/other/settings').send({ a: 1 }).expect(200);
    expect(other.saveSettings).toHaveBeenCalled();
    await request(app).post('/services/ai/api/other/train/data').send({ key: 'k', text: 't' }).expect(200);
    await request(app).get('/services/ai/api/other/train/data').expect(200);
    await request(app).get('/services/ai/api/other/train/status').expect(200);
    await request(app).delete('/services/ai/api/other/train/data/k').expect(200);

    await request(app).post('/services/ai/api/unknown/prompt').send({ prompt: 'hi' }).expect(200);
    expect(provider.prompt).toHaveBeenCalled();
  });

  it('does nothing without an express app', () => {
    expect(() => registerRoutes({}, eventEmitter, provider, analytics)).not.toThrow();
  });
});
