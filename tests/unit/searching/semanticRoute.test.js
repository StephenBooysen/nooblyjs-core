/**
 * @fileoverview Semantic search routes (feature 01): GET /services/searching/api/semantic
 * uses the vector provider's hybrid or semantic ranking, and refuses providers
 * without it.
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const searchRoutes = require('../../../src/searching/routes');
const createSearching = require('../../../src/searching');

describe('semantic search route (feature 01)', () => {
  it('ranks indexed documents by meaning with the vector provider', async () => {
    const app = express();
    const emitter = new EventEmitter();
    const vector = createSearching('vector', { embedding: { backend: 'hash', dimensions: 256 } }, emitter, {});
    searchRoutes({ 'express-app': app }, emitter, vector);
    await vector.indexDocument('d1', 'Rotate the settings secret with SETTINGS_SECRET.', { title: 'Settings' }, 'sem');
    await vector.indexDocument('d2', 'Queues retry failed jobs with backoff.', { title: 'Queues' }, 'sem');
    await vector.flushEmbeddings('sem');

    const hybrid = await request(app).get('/services/searching/api/semantic').query({ query: 'rotate the settings secret', index: 'sem', limit: 2 }).expect(200);
    expect(hybrid.body.mode).toBe('hybrid');
    expect(hybrid.body.data[0].title).toBe('Settings');

    const semantic = await request(app).get('/services/searching/api/semantic').query({ query: 'rotate the settings secret', index: 'sem', mode: 'semantic' }).expect(200);
    expect(semantic.body.mode).toBe('semantic');
    expect(semantic.body.data.length).toBeLessThanOrEqual(10);
  });

  it('answers 400 on a provider without semantic search', async () => {
    const app = express();
    const emitter = new EventEmitter();
    searchRoutes({ 'express-app': app }, emitter, { search: async () => [] });
    const res = await request(app).get('/services/searching/api/semantic').query({ query: 'anything' }).expect(400);
    expect(res.body.error).toMatch(/vector provider/);
  });

  it('refuses an empty or over-long query', async () => {
    const app = express();
    const emitter = new EventEmitter();
    searchRoutes({ 'express-app': app }, emitter, { hybridSearch: async () => [] });
    await request(app).get('/services/searching/api/semantic').query({ query: '' }).expect(400);
    await request(app).get('/services/searching/api/semantic').query({ query: 'x'.repeat(501) }).expect(400);
  });

  it('evaluates meaning search against labelled queries', async () => {
    const app = express();
    app.use(express.json());
    const emitter = new EventEmitter();
    const vector = createSearching('vector', { embedding: { backend: 'hash', dimensions: 256 } }, emitter, {});
    searchRoutes({ 'express-app': app }, emitter, vector);
    await vector.indexDocument('d1', 'Rotate the settings secret with SETTINGS_SECRET.', { title: 'Settings' }, 'ev');
    await vector.indexDocument('d2', 'Queues retry failed jobs with backoff and dead letters.', { title: 'Queues' }, 'ev');
    await vector.flushEmbeddings('ev');

    const res = await request(app).post('/services/searching/api/evaluate').send({
      index: 'ev',
      k: 2,
      cases: [
        { query: 'rotate the settings secret', expectedId: 'd1' },
        { query: 'dead letters for failed jobs', expectedId: 'd2' },
        { query: 'unrelated words entirely', expectedId: 'd9' }
      ]
    }).expect(200);
    expect(res.body.data).toEqual(expect.objectContaining({ mode: 'hybrid', k: 2, cases: 3 }));
    expect(res.body.data.recallAtK).toBeCloseTo(2 / 3);
    expect(res.body.data.results[0]).toEqual({ query: 'rotate the settings secret', expectedId: 'd1', rank: 1, hit: true });
    expect(res.body.data.results[2]).toEqual(expect.objectContaining({ rank: null, hit: false }));
  });

  it('refuses evaluation without cases, with a bad case, or on a provider without meaning search', async () => {
    const app = express();
    app.use(express.json());
    const emitter = new EventEmitter();
    searchRoutes({ 'express-app': app }, emitter, { hybridSearch: async () => [] });
    await request(app).post('/services/searching/api/evaluate').send({}).expect(400);
    await request(app).post('/services/searching/api/evaluate').send({ cases: [] }).expect(400);
    const bad = await request(app).post('/services/searching/api/evaluate').send({ cases: [{ query: 'q' }] }).expect(400);
    expect(bad.body.error).toMatch(/Case 1/);

    const plain = express();
    plain.use(express.json());
    searchRoutes({ 'express-app': plain }, emitter, { search: async () => [] });
    await request(plain).post('/services/searching/api/evaluate').send({ cases: [{ query: 'q', expectedId: 'a' }] }).expect(400);
  });
});
