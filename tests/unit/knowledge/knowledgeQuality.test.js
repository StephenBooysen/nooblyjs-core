/**
 * @fileoverview Knowledge service (feature 05), second half: PDF sources,
 * streamed answers, the legacy prompt() fallback, sources, feedback, evaluation
 * (including the YAML fixture, run with a scripted AI service and hash
 * embeddings), sync on filing changes, and the REST routes and dashboard.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const { KnowledgeBase } = require('../../../src/knowledge/providers/knowledge');
const { parseEvalCases } = require('../../../src/knowledge/modules/evaluate');
const createFiling = require('../../../src/filing');
const createSearching = require('../../../src/searching');
const { testDataDir } = require('../../helpers/testData');
const { minimalPdf } = require('../../helpers/minimalPdf');

const FIXTURES = path.join(__dirname, '../../fixtures/knowledge');
const created = [];

/** Copies files into a fresh folder under .temp and returns its path. */
function makeFolder(name, files = {}, { withFixtures = false } = {}) {
  const dir = path.join(testDataDir('knowledge'), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  if (withFixtures) fs.cpSync(path.join(FIXTURES, 'docs'), path.join(dir, 'docs'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  created.push(dir);
  return dir;
}

function build(dir, { ai, options = {}, emitter = new EventEmitter() } = {}) {
  const filing = createFiling('local', { baseDir: dir }, emitter);
  const searching = createSearching('vector', { embedding: { backend: 'hash', dimensions: 256 } }, emitter, {});
  const aiservice = ai || { complete: jest.fn(async () => ({ text: 'See [1].', usage: { input_tokens: 1 } })) };
  const kb = new KnowledgeBase({ filing, searching, aiservice }, { container: `kb-${Math.random()}`, topK: 3, ...options }, emitter);
  return { kb, filing, searching, emitter, ai: aiservice };
}

/**
 * A scripted AI service with complete() and stream(), shaped like the AI Service
 * v2 bridge (the shared module itself is ESM, which Jest cannot import here).
 * @param {string[]} replies Replies in order; the last one repeats
 */
function scriptedAi(replies) {
  const queue = [...replies];
  const next = () => (queue.length > 1 ? queue.shift() : queue[0]);
  return {
    complete: jest.fn(async () => ({ text: next(), usage: { input_tokens: 10, output_tokens: 5 } })),
    stream: jest.fn(async function* stream() {
      const text = next();
      for (let i = 0; i < text.length; i += 4) yield { type: 'text_delta', text: text.slice(i, i + 4) };
      yield { type: 'message', message: { usage: { input_tokens: 10, output_tokens: 5 } } };
    })
  };
}

afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

describe('PDF sources', () => {
  it('indexes the text of a PDF and uses its title', async () => {
    const dir = makeFolder('pdf', {
      'docs/records.pdf': minimalPdf(['Invoices are archived after seven years.', 'Ask finance for older copies.'], { title: 'Records Policy' })
    });
    const { kb } = build(dir);
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats).toEqual(expect.objectContaining({ added: 1, skipped: 0 }));
    const hits = await kb.retrieve('how long are invoices archived', { roles: ['*'] });
    expect(hits[0]).toEqual(expect.objectContaining({ path: 'docs/records.pdf', title: 'Records Policy' }));
    expect(hits[0].snippet).toMatch(/seven years/);
  });

  it('skips a file that is not a readable PDF and reports it without the parser error', async () => {
    const dir = makeFolder('badpdf', { 'docs/broken.pdf': 'not a pdf', 'docs/ok.md': '# OK\n\nfine' });
    const { kb } = build(dir);
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats).toEqual(expect.objectContaining({ added: 1, skipped: 1 }));
    expect(kb.status().skipped).toEqual([{ path: 'docs/broken.pdf', error: 'not a readable PDF' }]);

    fs.unlinkSync(path.join(dir, 'docs/broken.pdf'));
    await kb.sync({ directory: 'docs' });
    expect(kb.status().skipped).toEqual([]);
  });

  it('can leave PDFs out through the extensions option', async () => {
    const dir = makeFolder('nopdf', { 'docs/records.pdf': minimalPdf(['text']), 'docs/a.md': '# A\n\nalpha' });
    const { kb } = build(dir, { options: { extensions: ['.md'] } });
    expect((await kb.sync({ directory: 'docs' })).files).toBe(1);
  });
});

describe('streamed answers', () => {
  let dir;
  beforeAll(() => { dir = makeFolder('stream', {}, { withFixtures: true }); });

  async function collect(gen) {
    const events = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  it('yields sources, text deltas and a done event from a streaming AI service', async () => {
    const ai = scriptedAi(['Set a new SETTINGS_SECRET and restart [1].']);
    const { kb } = build(dir, { ai });
    await kb.sync({ directory: 'docs' });
    const events = await collect(kb.streamAnswer('How do I rotate the settings secret?', { roles: ['*'] }));
    expect(events[0].type).toBe('sources');
    expect(events[0].sources[0]).toEqual(expect.objectContaining({ n: 1, path: 'docs/settings.md' }));
    const deltas = events.filter((e) => e.type === 'text');
    expect(deltas.length).toBeGreaterThan(1);
    const done = events[events.length - 1];
    expect(done).toEqual(expect.objectContaining({ type: 'done', confidence: 'cited' }));
    expect(done.text).toBe(deltas.map((d) => d.text).join(''));
    expect(done.citations[0].path).toBe('docs/settings.md');
  });

  it('falls back to one text event when the AI service cannot stream', async () => {
    const { kb } = build(dir);
    await kb.sync({ directory: 'docs' });
    const events = await collect(kb.streamAnswer('settings secret', { roles: ['*'] }));
    expect(events.map((e) => e.type)).toEqual(['sources', 'text', 'done']);
  });

  it('answers that the sources do not cover a question when nothing readable matches', async () => {
    const { kb, ai } = build(dir, { options: { access: () => ['finance'] } });
    await kb.sync({ directory: 'docs' });
    const events = await collect(kb.streamAnswer('settings secret', { roles: ['support'] }));
    expect(events[events.length - 1]).toEqual(expect.objectContaining({ type: 'done', confidence: 'none' }));
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it('uses prompt() on a legacy AI service without complete()', async () => {
    const legacy = { prompt: jest.fn(async () => ({ content: 'From the docs [1].', usage: null })) };
    const { kb } = build(dir, { ai: legacy });
    await kb.sync({ directory: 'docs' });
    const answer = await kb.ask('settings secret', { roles: ['*'] });
    expect(answer.confidence).toBe('cited');
    expect(legacy.prompt).toHaveBeenCalledWith(expect.stringMatching(/only the numbered sources[\s\S]*SETTINGS_SECRET/), expect.any(Object));
  });

  it('writes server-sent events and an error event when the model fails', async () => {
    const ai = { complete: jest.fn(async () => { throw new Error('upstream exploded'); }) };
    const { kb } = build(dir, { ai });
    await kb.sync({ directory: 'docs' });
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      write(c) { chunks.push(c); },
      end: jest.fn()
    };
    const done = await kb.askStream(res, 'settings secret', { roles: ['*'] });
    expect(done).toBeNull();
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const body = chunks.join('');
    expect(body).toMatch(/^event: sources\n/);
    expect(body).toMatch(/event: error\ndata: \{"message":"The answer could not be generated"\}/);
    expect(body).not.toMatch(/exploded/);
    expect(res.end).toHaveBeenCalled();
  });
});

describe('sources, feedback and evaluation', () => {
  it('lists only the sources the caller may read', async () => {
    const dir = makeFolder('sources', { 'hr/pay.md': '# Pay\n\nsalary bands', 'docs/a.md': '# A\n\nalpha' });
    const { kb } = build(dir, { options: { access: (p) => (p.startsWith('hr/') ? ['hr'] : ['*']) } });
    await kb.sync();
    expect(kb.sources({ roles: ['user'] }).map((s) => s.path)).toEqual(['docs/a.md']);
    const all = kb.sources({ roles: ['*'] });
    expect(all.map((s) => s.path)).toEqual(['docs/a.md', 'hr/pay.md']);
    expect(all[1]).toEqual(expect.objectContaining({ title: 'Pay', chunks: 1, roles: ['hr'], indexedAt: expect.any(String) }));
  });

  it('records, caps, lists, saves and restores feedback', async () => {
    const dir = makeFolder('feedback', { 'docs/a.md': '# A\n\nalpha' });
    const emitter = new EventEmitter();
    const emitted = jest.spyOn(emitter, 'emit');
    const { kb } = build(dir, { emitter, options: { maxFeedback: 2, container: 'fb' } });
    await kb.recordFeedback({ question: 'q1', rating: 'good', citations: ['docs/a.md'] });
    await kb.recordFeedback({ question: 'q2', rating: 'bad' });
    await kb.recordFeedback({ question: 'q3', rating: 'good', citations: ['docs/a.md'], user: 'ana@example.com' });
    expect(emitted).toHaveBeenCalledWith('knowledge:feedback', expect.objectContaining({ rating: 'good', citations: 1 }));

    const list = kb.listFeedback();
    expect(list).toEqual(expect.objectContaining({ total: 2, good: 1, bad: 1 }));
    expect(list.items.map((f) => f.question)).toEqual(['q3', 'q2']);
    expect(kb.listFeedback({ rating: 'bad' }).items.map((f) => f.question)).toEqual(['q2']);
    expect(kb.feedbackCases()).toEqual([{ question: 'q3', expectedPath: 'docs/a.md' }]);
    expect(fs.existsSync(path.join(dir, '.knowledge-feedback.json'))).toBe(true);

    const restored = build(dir, { options: { restore: true, container: 'fb2' } }).kb;
    await restored.sync();
    expect(restored.listFeedback().total).toBe(2);
    expect(restored.status().feedback).toEqual({ total: 2, good: 1, bad: 1 });
  });

  it('refuses a rating that is not good or bad', async () => {
    const { kb } = build(makeFolder('fbbad'));
    await expect(kb.recordFeedback({ question: 'q', rating: 'meh' })).rejects.toThrow(/good or bad/);
    await expect(kb.recordFeedback({ question: ' ', rating: 'good' })).rejects.toThrow(/question/);
  });

  it('parses YAML cases and explains what is wrong with bad ones', () => {
    expect(parseEvalCases('- question: a\n  expectedPath: b\n  roles: [x]')).toEqual([{ question: 'a', expectedPath: 'b', roles: ['x'] }]);
    expect(parseEvalCases('cases:\n  - question: a\n    expectedPath: b')).toHaveLength(1);
    expect(() => parseEvalCases('question: a')).toThrow(/YAML list/);
    expect(() => parseEvalCases('- question: a')).toThrow(/case 1 needs/);
    expect(() => parseEvalCases('- [unclosed')).toThrow(/not valid YAML/);
  });

  it('scores the fixture questions: every expected file found and cited (scripted AI, hash embeddings)', async () => {
    const dir = makeFolder('eval', {}, { withFixtures: true });
    const yamlText = fs.readFileSync(path.join(FIXTURES, 'eval.yaml'), 'utf8');
    const cases = parseEvalCases(yamlText);
    // The mock model cites source [1], the top retrieved chunk, for each question.
    const ai = scriptedAi(['The answer is in the first source [1].']);
    const emitter = new EventEmitter();
    const emitted = jest.spyOn(emitter, 'emit');
    const { kb } = build(dir, { ai, emitter });
    await kb.sync({ directory: 'docs' });

    const report = await kb.evaluate(yamlText, { k: 3, answers: true });
    expect(report.cases).toBe(3);
    expect(report.recallAtK).toBe(1);
    expect(report.meanReciprocalRank).toBe(1);
    expect(report.citationAccuracy).toBe(1);
    expect(report.answerResults.every((r) => r.cited && r.confidence === 'cited')).toBe(true);
    expect(emitted).toHaveBeenCalledWith('knowledge:evaluated', expect.objectContaining({ cases: 3, recallAtK: 1, citationAccuracy: 1 }));
  });
});

describe('sync on filing changes', () => {
  afterEach(() => jest.useRealTimers());

  it('syncs once after a burst of changes and ignores its own state files', async () => {
    jest.useFakeTimers();
    const dir = makeFolder('watch', { 'docs/a.md': '# A\n\nalpha' });
    const emitter = new EventEmitter();
    const { kb } = build(dir, { emitter, options: { watch: true, watchDirectory: 'docs', watchDelayMs: 500 } });
    const sync = jest.spyOn(kb, 'sync').mockResolvedValue({});

    emitter.emit('filing:create', { filePath: path.join(dir, 'docs/b.md') });
    emitter.emit('filing:update', { filePath: path.join(dir, 'docs/a.md') });
    emitter.emit('filing:update', { filePath: path.join(dir, '.knowledge-state.json') });
    jest.advanceTimersByTime(499);
    expect(sync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({ directory: 'docs' });

    emitter.emit('filing:update', { filePath: path.join(dir, '.knowledge-feedback.json') });
    jest.advanceTimersByTime(1000);
    expect(sync).toHaveBeenCalledTimes(1);

    kb.destroy();
    expect(emitter.listenerCount('filing:create')).toBe(0);
    emitter.emit('filing:delete', { filePath: path.join(dir, 'docs/a.md') });
    jest.advanceTimersByTime(1000);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('runs a sync that starts during another one after it', async () => {
    const dir = makeFolder('serial', { 'docs/a.md': '# A\n\nalpha' });
    const { kb } = build(dir);
    const [first, second] = await Promise.all([kb.sync({ directory: 'docs' }), kb.sync({ directory: 'docs' })]);
    expect(first.added).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(kb.status()).toEqual(expect.objectContaining({ syncing: false, lastSync: expect.objectContaining({ directory: 'docs', unchanged: 1 }) }));
  });
});

describe('knowledge routes: sources, stream, feedback, evaluate, dashboard', () => {
  let app;
  let registry;
  beforeAll(async () => {
    const dir = makeFolder('routes', {}, { withFixtures: true });
    app = express();
    app.use(express.json());
    registry = require('../../../index');
    registry.reset?.();
    registry.initialize(app, new EventEmitter(), { apiKeys: ['k'], requireApiKey: true, security: { servicesAuth: { requireLogin: true } } });
    registry.filing('local', { baseDir: dir });
    const ai = scriptedAi(['Restart with a new SETTINGS_SECRET [1].']);
    registry.knowledge('default', { container: 'kb-routes', dependencies: { aiservice: ai } });
    await request(app).post('/services/knowledge/api/sync').set('x-api-key', 'k').send({ directory: 'docs' }).expect(200);
  });
  afterAll(async () => { await registry.shutdown?.(); registry.reset?.(); });

  const api = (method, url) => request(app)[method](`/services/knowledge/api${url}`).set('x-api-key', 'k');

  it('lists the indexed sources', async () => {
    const res = await api('get', '/sources').expect(200);
    expect(res.body.data.map((s) => s.path)).toEqual(['docs/queues.md', 'docs/sessions.md', 'docs/settings.md']);
  });

  it('streams an answer as server-sent events', async () => {
    const res = await api('post', '/ask/stream')
      .send({ question: 'How do I rotate the settings secret?' })
      .buffer(true)
      .parse((r, cb) => { let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => cb(null, t)); })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = res.body.split('\n\n').filter(Boolean).map((block) => block.split('\n')[0].replace('event: ', ''));
    expect(events[0]).toBe('sources');
    expect(events).toContain('text');
    expect(events[events.length - 1]).toBe('done');
    expect(res.body).toMatch(/"confidence":"cited"/);
  });

  it('validates a streamed question before streaming', async () => {
    await api('post', '/ask/stream').send({ question: '' }).expect(400);
  });

  it('records feedback and lists it', async () => {
    await api('post', '/feedback').send({ question: 'q', rating: 'good', citations: ['docs/settings.md'] }).expect(201);
    await api('post', '/feedback').send({ question: 'q', rating: 'great' }).expect(400);
    const res = await api('get', '/feedback?rating=good').expect(200);
    expect(res.body.data.items[0]).toEqual(expect.objectContaining({ question: 'q', citations: ['docs/settings.md'], user: expect.stringMatching(/^key:/) }));
  });

  it('evaluates YAML cases, cases from feedback, and refuses bad input', async () => {
    const yamlText = fs.readFileSync(path.join(FIXTURES, 'eval.yaml'), 'utf8');
    const res = await api('post', '/evaluate').send({ yaml: yamlText, k: 3 }).expect(200);
    expect(res.body.data).toEqual(expect.objectContaining({ cases: 3, recallAtK: 1 }));
    const fromFeedback = await api('post', '/evaluate').send({ fromFeedback: true }).expect(200);
    expect(fromFeedback.body.data.cases).toBe(1);
    const bad = await api('post', '/evaluate').send({ yaml: 'question: a' }).expect(400);
    expect(bad.body.message || bad.body.error).toMatch(/YAML list/);
    await api('post', '/evaluate').send({}).expect(400);
    await api('post', '/evaluate').send({ cases: [{ question: 'a' }] }).expect(400);
  });

  it('serves the dashboard page and its script', async () => {
    const page = await request(app).get('/services/knowledge/').set('x-api-key', 'k');
    expect([200, 302, 401]).toContain(page.status);
    if (page.status === 200) expect(page.text).toMatch(/<title>Knowledge/);
    const html = fs.readFileSync(path.join(__dirname, '../../../src/knowledge/views/index.html'), 'utf8');
    expect(html).not.toMatch(/<script>(?!<\/script>)|\son[a-z]+="/i);
    expect(html).not.toMatch(/style="/);
  });
});
