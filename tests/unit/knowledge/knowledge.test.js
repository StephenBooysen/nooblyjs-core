/**
 * @fileoverview Knowledge service (feature 05): incremental sync, role-filtered
 * retrieval, grounded answers with citations, streaming, evaluation and routes.
 * Runs offline: hash embeddings for search, the scripted mock for answers.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');

const serviceRegistry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');
const { NO_ANSWER } = require('../../../src/knowledge/providers/knowledge');

const FILES = {
  'ops/secrets.md': [
    '# Settings secret',
    '',
    'To rotate the settings secret, run the rotate command and restart the service.',
    ''
  ].join('\n'),
  'ops/billing.md': [
    '---',
    'roles: [billing]',
    '---',
    '# Invoices',
    '',
    'Monthly invoices are emailed on the first working day of the month.',
    ''
  ].join('\n'),
  'help/faq.html': '<html><head><title>Support FAQ</title></head><body><h1>FAQ</h1><p>Reset a forgotten password from the sign-in page.</p><script>var x=1;</script></body></html>'
};

/** Reads SSE frames from a streamed body into { event, data } objects. */
function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((frame) => {
    const event = /^event: (.*)$/m.exec(frame)?.[1];
    const data = /^data: (.*)$/m.exec(frame)?.[1];
    return { event, data: data ? JSON.parse(data) : null };
  });
}

describe('Knowledge service (feature 05)', () => {
  let dir;
  let docsDir;
  let search;
  let ai;
  let service;
  let filing;

  /** Writes the fixture files (re-writes them on every call to the same path). */
  function writeFile(rel, content) {
    const full = path.join(docsDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  /** Builds the knowledge service over the fixture folder with a scripted model. */
  function build(script = [{ text: 'Rotate it with the rotate command [1].' }]) {
    serviceRegistry.reset();
    const events = new EventEmitter();
    serviceRegistry.initialize(express(), events, {
      security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } }
    });
    filing = serviceRegistry.filing('local', { baseDir: docsDir });
    search = serviceRegistry.searching('vector', {
      fields: ['title', 'body'],
      autoEmbed: false
    });
    ai = serviceRegistry.aiservice('mock', { legacy: false, script });
    service = serviceRegistry.knowledge('default', {
      filing,
      search,
      ai,
      source: { path: '' },
      containerName: 'kb-test'
    });
    return service;
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(testDataDir('knowledge'), 'kb-'));
    docsDir = path.join(dir, 'docs');
  });

  /** Each test starts from the same fixture files. */
  beforeEach(() => {
    fs.rmSync(docsDir, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(FILES)) writeFile(rel, content);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    serviceRegistry.reset();
  });

  describe('sync', () => {
    it('indexes every supported file and skips unchanged ones on the next run', async () => {
      build();
      const first = await service.sync();
      expect(first).toEqual(expect.objectContaining({ added: 3, updated: 0, unchanged: 0, removed: 0, failed: 0 }));
      expect(first.chunks).toBeGreaterThan(0);
      expect(service.status()).toEqual(expect.objectContaining({ documents: 3 }));

      const second = await service.sync();
      expect(second).toEqual(expect.objectContaining({ added: 0, updated: 0, unchanged: 3, chunks: 0 }));
    });

    it('re-embeds only the file that changed', async () => {
      build();
      await service.sync();
      const addAll = jest.spyOn(search, 'addAll');

      writeFile('ops/secrets.md', '# Settings secret\n\nRotate the secret every quarter using the vault.\n');
      const stats = await service.sync();

      expect(stats).toEqual(expect.objectContaining({ added: 0, updated: 1, unchanged: 2 }));
      const indexed = addAll.mock.calls.flatMap(([docs]) => docs.map((d) => d.id));
      expect(indexed.length).toBeGreaterThan(0);
      expect(indexed.every((id) => id.startsWith('ops/secrets.md#'))).toBe(true);
    });

    it('removes files that no longer exist from the index', async () => {
      build();
      await service.sync();
      fs.rmSync(path.join(docsDir, 'help', 'faq.html'));
      const stats = await service.sync();
      expect(stats.removed).toBe(1);
      expect(service.sources().map((s) => s.path)).not.toContain('help/faq.html');
      const hits = await service.retrieve('forgotten password', { roles: ['*'] });
      expect(hits.every((h) => h.path !== 'help/faq.html')).toBe(true);
    });
  });

  describe('retrieval and access', () => {
    beforeEach(async () => {
      build();
      await service.sync();
    });

    it('returns the passage that answers the question, with its source', async () => {
      const hits = await service.retrieve('how do I rotate the settings secret', { roles: ['*'] });
      expect(hits[0].path).toBe('ops/secrets.md');
      expect(hits[0]).toEqual(expect.objectContaining({ title: 'Settings secret', chunkId: expect.stringContaining('ops/secrets.md#') }));
    });

    it('hides role-restricted chunks from callers without the role', async () => {
      const anonymous = await service.retrieve('monthly invoices emailed', {});
      expect(anonymous.map((h) => h.path)).not.toContain('ops/billing.md');

      const billing = await service.retrieve('monthly invoices emailed', { roles: ['billing'] });
      expect(billing.map((h) => h.path)).toContain('ops/billing.md');
    });

    it('rejects an empty question', async () => {
      await expect(service.retrieve('   ')).rejects.toThrow('A question is required');
    });
  });

  describe('answers', () => {
    it('cites the source it used and reports high confidence', async () => {
      build([{ text: 'Rotate the settings secret with the rotate command [1].' }]);
      await service.sync();
      const answer = await service.ask('how do I rotate the settings secret');
      expect(answer.text).toContain('[1]');
      expect(answer.confidence).toBe('high');
      expect(answer.citations).toEqual([expect.objectContaining({ n: 1, path: 'ops/secrets.md', title: 'Settings secret' })]);
    });

    it('flags an answer that cites no source as low confidence', async () => {
      build([{ text: 'Rotating is something you do to secrets.' }]);
      await service.sync();
      const answer = await service.ask('how do I rotate the settings secret');
      expect(answer.citations).toEqual([]);
      expect(answer.confidence).toBe('low');
    });

    it('drops citations that point at no source', async () => {
      build([{ text: 'Invoices go out early in the month [9].' }]);
      await service.sync();
      const answer = await service.ask('when are invoices sent', { roles: ['billing'] });
      expect(answer.text).toContain('[9]');
      expect(answer.citations.find((c) => c.n === 9)).toBeUndefined();
      expect(answer.confidence).toBe('low');
    });

    it('answers without calling the model when nothing is indexed', async () => {
      build([{ text: 'should not be used' }]);
      const complete = jest.spyOn(ai, 'complete');
      const answer = await service.ask('anything at all', { roles: ['*'] });
      expect(answer).toEqual(expect.objectContaining({ text: NO_ANSWER, confidence: 'none', citations: [] }));
      expect(complete).not.toHaveBeenCalled();
    });

    it('needs an AI service for answers', async () => {
      serviceRegistry.reset();
      serviceRegistry.initialize(express(), new EventEmitter(), {
        security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } }
      });
      const noAi = new (require('../../../src/knowledge/providers/knowledge'))({ search, filing });
      await expect(noAi.ask('anything')).rejects.toThrow('Answers need an AI service');
    });
  });

  describe('evaluation', () => {
    it('reports retrieval hit rate and citation accuracy on labelled cases', async () => {
      build([{ text: 'Rotate it with the rotate command [1].' }]);
      await service.sync();
      const report = await service.evaluate([
        { question: 'rotate the settings secret', expected: ['ops/secrets.md'] }
      ], { k: 3 });
      expect(report.cases).toBe(1);
      expect(report.retrievalHitRate).toBe(1);
      expect(report.citationAccuracy).toBe(1);
    });
  });

  describe('HTTP routes', () => {
    let app;

    beforeEach(async () => {
      build([
        { text: 'Rotate it with the rotate command [1].' },
        { text: 'Rotate it with the rotate command [1].' },
        { text: 'Rotate it with the rotate command [1].' }
      ]);
      await service.sync();
      app = express();
      app.use(express.json());
      // Mount the same service on a fresh app so the routes are registered.
      require('../../../src/knowledge/routes')({ 'express-app': app }, new EventEmitter(), service);
    });

    it('answers a question with citations', async () => {
      const res = await request(app).post('/services/knowledge/api/ask')
        .send({ question: 'rotate the settings secret' }).expect(200);
      expect(res.body.citations[0].path).toBe('ops/secrets.md');
    });

    it('validates the question', async () => {
      await request(app).post('/services/knowledge/api/ask').send({}).expect(400);
      await request(app).post('/services/knowledge/api/ask').send({ question: 'x', k: 999 }).expect(400);
    });

    it('streams sources, text and a final done event', async () => {
      const res = await request(app).post('/services/knowledge/api/ask/stream')
        .buffer(true).parse((r, cb) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => cb(null, d)); })
        .send({ question: 'rotate the settings secret' }).expect(200);
      const events = parseSse(res.body).map((e) => e.event);
      expect(events[0]).toBe('sources');
      expect(events).toContain('text');
      expect(events[events.length - 1]).toBe('done');
    });

    it('returns passages for retrieve and status for the dashboard', async () => {
      const passages = await request(app).post('/services/knowledge/api/retrieve')
        .send({ query: 'settings secret' }).expect(200);
      expect(passages.body.results.length).toBeGreaterThan(0);

      const status = await request(app).get('/services/knowledge/api/status').expect(200);
      expect(status.body).toEqual(expect.objectContaining({ documents: 3, answers: true }));

      const sources = await request(app).get('/services/knowledge/api/sources').expect(200);
      expect(sources.body.sources.map((s) => s.path)).toEqual(expect.arrayContaining(['ops/secrets.md']));
    });
  });
});
