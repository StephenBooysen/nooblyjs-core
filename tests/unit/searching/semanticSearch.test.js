/**
 * @fileoverview Semantic search over real embeddings and its HTTP routes
 * (feature 01). The vector searching provider embeds through the AI service
 * (`embedding.backend: 'aiservice'`), here the offline mock provider.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');

const serviceRegistry = require('../../../index');

const DOCS = [
  { id: 'reset', title: 'Credential recovery', body: 'How to reset a forgotten password using the email link.' },
  { id: 'rotate', title: 'Rotating secrets', body: 'Rotate the settings encryption secret without losing data.' },
  { id: 'billing', title: 'Invoices', body: 'Download monthly invoices and payment receipts.' }
];

/** Boots the registry with a semantic search over the mock AI service. */
function boot({ semantic = true } = {}) {
  serviceRegistry.reset();
  const app = express();
  app.use(express.json());
  serviceRegistry.initialize(app, new EventEmitter(), {
    security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } }
  });
  const searching = semantic
    ? serviceRegistry.searching('vector', {
      fields: ['title', 'body'],
      embedding: { backend: 'aiservice', aiservice: serviceRegistry.aiservice('mock', {}) },
      autoEmbed: false
    })
    : serviceRegistry.searching('memory', { fields: ['title', 'body'] });
  return { app, searching };
}

describe('Semantic search (feature 01)', () => {
  afterEach(() => serviceRegistry.reset());

  describe('embeddings through the AI service', () => {
    it('reports the aiservice backend in the status', async () => {
      const { app } = boot();
      const res = await request(app).get('/services/searching/api/semantic/status').expect(200);
      expect(res.body).toEqual(expect.objectContaining({ enabled: true, backend: 'aiservice', provider: 'vector' }));
      expect(res.body.dimensions).toBeGreaterThan(0);
    });

    it('embeds documents and ranks them for a query after flushing', async () => {
      const { app, searching } = boot();
      await searching.addAll(DOCS);
      await request(app).post('/services/searching/api/semantic/flush').send({}).expect(200);

      const res = await request(app)
        .post('/services/searching/api/semantic/search')
        .send({ query: 'forgot my password', mode: 'semantic', k: 3 })
        .expect(200);
      expect(res.body.mode).toBe('semantic');
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0]).toEqual(expect.objectContaining({ id: expect.any(String) }));
    });

    it('answers hybrid and keyword modes from the same index', async () => {
      const { app, searching } = boot();
      await searching.addAll(DOCS);
      await searching.flushEmbeddings();

      const hybrid = await request(app).post('/services/searching/api/semantic/search')
        .send({ query: 'password reset', mode: 'hybrid' }).expect(200);
      expect(hybrid.body.results.map((r) => r.id)).toContain('reset');

      const keyword = await request(app).post('/services/searching/api/semantic/search')
        .send({ query: 'invoices', mode: 'keyword' }).expect(200);
      expect(keyword.body.results[0].id).toBe('billing');
    });

    it('finds documents similar to a stored one, and 404s for an unknown id', async () => {
      const { app, searching } = boot();
      await searching.addAll(DOCS);
      await searching.flushEmbeddings();

      const res = await request(app).get('/services/searching/api/semantic/similar/reset').expect(200);
      expect(res.body.id).toBe('reset');
      expect(Array.isArray(res.body.results)).toBe(true);

      await request(app).get('/services/searching/api/semantic/similar/no-such-doc').expect(404);
    });
  });

  describe('request handling', () => {
    it('rejects an unknown mode with 400', async () => {
      const { app } = boot();
      await request(app).post('/services/searching/api/semantic/search')
        .send({ query: 'x', mode: 'telepathic' }).expect(400);
    });

    it('answers 409 on a keyword-only provider', async () => {
      const { app } = boot({ semantic: false });
      await request(app).get('/services/searching/api/semantic/status').expect(409);
      await request(app).post('/services/searching/api/semantic/search').send({ query: 'x' }).expect(409);
    });
  });
});
