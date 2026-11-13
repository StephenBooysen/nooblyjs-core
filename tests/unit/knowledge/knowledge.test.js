/**
 * @fileoverview Knowledge service (feature 05): chunking, incremental sync, retrieval,
 * grounded answers with citations, and the REST routes. The AI model is a stub,
 * so answers are deterministic; retrieval uses the real vector index with hash
 * embeddings.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const { chunkMarkdown } = require('../../../src/knowledge/modules/chunk');
const { KnowledgeBase } = require('../../../src/knowledge/providers/knowledge');
const createFiling = require('../../../src/filing');
const createSearching = require('../../../src/searching');
const { testDataDir } = require('../../helpers/testData');

const SETTINGS_DOC = '# Settings\n\n## Secret\n\nRotate the settings secret with the SETTINGS_SECRET variable and restart the app.\n';
const QUEUE_DOC = '# Queues\n\n## Retries\n\nJobs retry with exponential backoff and move to a dead-letter queue after the last attempt.\n';

/** Writes files into a fresh folder and returns its path. */
function makeFolder(name, files) {
  const dir = path.join(testDataDir('knowledge'), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

/** AI stub: cites source [1] unless told otherwise. */
function stubAi(text = 'Rotate it with SETTINGS_SECRET and restart [1].') {
  return { complete: jest.fn(async () => ({ text, usage: { inputTokens: 1, outputTokens: 1 } })) };
}

function build({ dir, ai = stubAi() }) {
  const emitter = new EventEmitter();
  const filing = createFiling('local', { baseDir: dir }, emitter);
  const searching = createSearching('vector', { embedding: { backend: 'hash', dimensions: 256 } }, emitter, {});
  const kb = new KnowledgeBase({ filing, searching, aiservice: ai }, { container: 'kb-test', topK: 3 }, emitter);
  return { kb, searching, filing, emitter, ai };
}

describe('chunking (feature 05)', () => {
  it('never crosses a heading and names each chunk by its heading', () => {
    const chunks = chunkMarkdown('# A\n\nalpha text.\n\n## B\n\nbeta text.');
    expect(chunks.map((c) => c.heading)).toEqual(['A', 'B']);
    expect(chunks[1].text).toMatch(/beta/);
  });

  it('splits a long section and repeats some text across the split', () => {
    const para = Array.from({ length: 80 }, (_, i) => `sentence${i}`).join(' ');
    const chunks = chunkMarkdown(`# Long\n\n${para}`, { maxChars: 400, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.length <= 400)).toBe(true);
    const tail = chunks[0].text.slice(-30);
    expect(chunks[1].text.includes(tail.slice(-20))).toBe(true);
  });

  it('returns nothing for empty text', () => {
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
  });
});

describe('knowledge base (feature 05)', () => {
  let dir;
  let kb;
  let searching;
  let ai;

  beforeEach(() => {
    dir = makeFolder('kb', { 'docs/settings.md': SETTINGS_DOC, 'docs/queues.md': QUEUE_DOC, 'docs/.hidden/secret.md': 'x', 'docs/image.png': 'binary' });
    ({ kb, searching, ai } = build({ dir }));
  });

  it('syncs Markdown files, skipping hidden folders and other types', async () => {
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats).toEqual(expect.objectContaining({ files: 2, added: 2, changed: 0, unchanged: 0, removed: 0 }));
    expect(kb.status().files).toBe(2);
  });

  it('re-indexes nothing when no file changed', async () => {
    await kb.sync({ directory: 'docs' });
    const spy = jest.spyOn(searching, 'indexDocument');
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats).toEqual(expect.objectContaining({ added: 0, changed: 0, unchanged: 2 }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('re-embeds only the chunks of the file that changed', async () => {
    await kb.sync({ directory: 'docs' });
    fs.writeFileSync(path.join(dir, 'docs/queues.md'), `${QUEUE_DOC}\n## Added\n\nA new section.\n`);
    const spy = jest.spyOn(searching, 'indexDocument');
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats).toEqual(expect.objectContaining({ changed: 1, unchanged: 1 }));
    const ids = spy.mock.calls.map((c) => c[0]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('docs/queues.md#'))).toBe(true);
  });

  it('removes the chunks of a deleted file', async () => {
    await kb.sync({ directory: 'docs' });
    fs.unlinkSync(path.join(dir, 'docs/queues.md'));
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats.removed).toBe(1);
    const hits = await kb.retrieve('dead-letter queue backoff');
    expect(hits.some((h) => h.path === 'docs/queues.md')).toBe(false);
  });

  it('retrieves the chunk that answers the question first', async () => {
    await kb.sync({ directory: 'docs' });
    const hits = await kb.retrieve('how do I rotate the settings secret');
    expect(hits[0].path).toBe('docs/settings.md');
    expect(hits[0].snippet).toMatch(/SETTINGS_SECRET/);
  });

  it('answers with citations to the sources it used', async () => {
    await kb.sync({ directory: 'docs' });
    const answer = await kb.ask('how do I rotate the settings secret');
    expect(answer.confidence).toBe('cited');
    expect(answer.citations[0]).toEqual(expect.objectContaining({ n: 1, path: 'docs/settings.md' }));
    expect(ai.complete).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringMatching(/only the numbered sources/),
      messages: [expect.objectContaining({ content: expect.stringMatching(/SETTINGS_SECRET/) })]
    }));
  });

  it('flags an answer with no citation as low confidence', async () => {
    await kb.sync({ directory: 'docs' });
    ({ kb } = build({ dir, ai: stubAi('Probably, but I am not sure.') }));
    await kb.sync({ directory: 'docs' });
    const answer = await kb.ask('how do I rotate the settings secret');
    expect(answer.confidence).toBe('low');
    expect(answer.citations).toEqual([]);
  });

  it('does not call the model when nothing is indexed', async () => {
    const answer = await kb.ask('anything at all');
    expect(answer.confidence).toBe('none');
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('needs a vector search instance', () => {
    expect(() => new KnowledgeBase({ filing: {}, searching: {}, aiservice: {} })).toThrow(/vector search/);
  });
});

describe('knowledge REST routes and registry (feature 05)', () => {
  let app;
  let registry;
  let dir;
  beforeAll(async () => {
    dir = makeFolder('kb-api', { 'docs/settings.md': SETTINGS_DOC });
    app = express();
    app.use(express.json());
    registry = require('../../../index');
    registry.initialize(app, new EventEmitter(), { apiKeys: ['k'], requireApiKey: true, security: { servicesAuth: { requireLogin: true } } });
    registry.filing('local', { baseDir: dir });
    registry.knowledge('default', { container: 'kb-api', dependencies: { aiservice: stubAi() } });
  });
  afterAll(async () => { await registry.shutdown?.(); registry.reset?.(); });

  it('syncs, retrieves and asks over HTTP with an API key', async () => {
    const sync = await request(app).post('/services/knowledge/api/sync').set('x-api-key', 'k').send({ directory: 'docs' }).expect(200);
    expect(sync.body.data.added).toBe(1);
    const hits = await request(app).post('/services/knowledge/api/retrieve').set('x-api-key', 'k').send({ question: 'settings secret' }).expect(200);
    expect(hits.body.data[0].path).toBe('docs/settings.md');
    const ask = await request(app).post('/services/knowledge/api/ask').set('x-api-key', 'k').send({ question: 'settings secret' }).expect(200);
    expect(ask.body.data.confidence).toBe('cited');
  });

  it('refuses a question that is empty or too long, and a request without a key', async () => {
    await request(app).post('/services/knowledge/api/ask').set('x-api-key', 'k').send({ question: '' }).expect(400);
    await request(app).post('/services/knowledge/api/ask').set('x-api-key', 'k').send({ question: 'x'.repeat(1001) }).expect(400);
    await request(app).post('/services/knowledge/api/ask').send({ question: 'settings' }).expect(401);
  });

  it('reports the indexed counts', async () => {
    const status = await request(app).get('/services/knowledge/api/status').set('x-api-key', 'k').expect(200);
    expect(status.body.data.files).toBeGreaterThanOrEqual(1);
  });

  it('describes its routes in the merged OpenAPI document', async () => {
    const doc = registry.buildOpenApi();
    expect(doc.paths['/services/knowledge/api/ask']).toBeDefined();
    expect(doc.paths['/services/knowledge/api/ask'].post['x-undocumented']).toBeUndefined();
  });
});
