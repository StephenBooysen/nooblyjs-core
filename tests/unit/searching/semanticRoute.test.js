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
});
