/**
 * @fileoverview Knowledge service (feature 05): access rules, restoring saved
 * state after a restart, HTML sources, the evaluation harness, and the roles the
 * routes pass in. Uses the hash embedding backend and a stub model.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const { KnowledgeBase, htmlToText, mayRead } = require('../../../src/knowledge/providers/knowledge');
const createFiling = require('../../../src/filing');
const createSearching = require('../../../src/searching');
const createKnowledgeService = require('../../../src/knowledge');
const { evaluateRetrieval } = require('../../../src/knowledge/modules/evaluate');
const { testDataDir } = require('../../helpers/testData');

const PUBLIC_DOC = '# Settings\n\n## Secret\n\nRotate the settings secret with the SETTINGS_SECRET variable and restart the app.\n';
const PRIVATE_DOC = '# Payroll\n\n## Bands\n\nThe salary band for grade seven is CONFIDENTIAL-9000 and is not for staff.\n';

function makeFolder(files) {
  const dir = path.join(testDataDir('knowledge'), `acc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function stubAi(text = 'Rotate it with SETTINGS_SECRET [1].') {
  return { complete: jest.fn(async () => ({ text, usage: null })) };
}

function build({ dir, ai = stubAi(), ...options }) {
  const emitter = new EventEmitter();
  const filing = createFiling('local', { baseDir: dir }, emitter);
  const searching = createSearching('vector', { embedding: { backend: 'hash', dimensions: 256 } }, emitter, {});
  const kb = new KnowledgeBase({ filing, searching, aiservice: ai }, { container: 'acc', topK: 3, ...options }, emitter);
  return { kb, searching, filing, ai };
}

describe('access rules (feature 05)', () => {
  it('mayRead: a caller sees documents open to a role it holds, or to everyone', () => {
    expect(mayRead(['*'], [])).toBe(true);
    expect(mayRead(['admin'], [])).toBe(false);
    expect(mayRead(['admin'], ['admin'])).toBe(true);
    expect(mayRead(['admin'], ['*'])).toBe(true);
    expect(mayRead(['staff'], ['admin'])).toBe(false);
  });

  it('keeps a restricted document out of retrieval and out of the model prompt', async () => {
    const dir = makeFolder({ 'docs/settings.md': PUBLIC_DOC, 'docs/payroll.md': PRIVATE_DOC });
    const access = (file) => (file.includes('payroll') ? ['admin'] : ['*']);
    const { kb, ai } = build({ dir, access });
    await kb.sync({ directory: 'docs' });

    const asUser = await kb.retrieve('salary band for grade seven', { roles: [] });
    expect(asUser.some((h) => h.path === 'docs/payroll.md')).toBe(false);

    const asAdmin = await kb.retrieve('salary band for grade seven', { roles: ['admin'] });
    expect(asAdmin[0].path).toBe('docs/payroll.md');

    await kb.ask('what is the salary band for grade seven', { roles: [] });
    const prompt = JSON.stringify(ai.complete.mock.calls[0] || []);
    expect(prompt).not.toMatch(/CONFIDENTIAL-9000/);
  });

  it('re-indexes a file when only its access rule changes', async () => {
    const dir = makeFolder({ 'docs/settings.md': PUBLIC_DOC });
    let rule = ['*'];
    const { kb } = build({ dir, access: () => rule });
    await kb.sync({ directory: 'docs' });
    rule = ['admin'];
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats.changed).toBe(1);
    expect((await kb.retrieve('settings secret', { roles: [] })).length).toBe(0);
  });
});

describe('restoring saved state (feature 05)', () => {
  it('restores the index after a restart without reading the source files', async () => {
    const dir = makeFolder({ 'docs/settings.md': PUBLIC_DOC });
    const first = build({ dir });
    await first.kb.sync({ directory: 'docs' });
    expect(fs.existsSync(path.join(dir, '.knowledge-state.json'))).toBe(true);

    const second = build({ dir, restore: true });
    const readSpy = jest.spyOn(second.filing, 'read');
    await second.kb.ready_;
    expect(second.kb.status().files).toBe(1);
    const hits = await second.kb.retrieve('settings secret');
    expect(hits[0].path).toBe('docs/settings.md');
    const readSources = readSpy.mock.calls.filter(([p]) => p !== '.knowledge-state.json');
    expect(readSources).toEqual([]);
  });

  it('after a restart, a sync only re-indexes the file that changed', async () => {
    const dir = makeFolder({ 'docs/settings.md': PUBLIC_DOC, 'docs/other.md': '# Other\n\nSomething else entirely.\n' });
    await build({ dir }).kb.sync({ directory: 'docs' });
    fs.writeFileSync(path.join(dir, 'docs/other.md'), '# Other\n\nSomething changed here.\n');
    const second = build({ dir, restore: true });
    const stats = await second.kb.sync({ directory: 'docs' });
    expect(stats).toEqual(expect.objectContaining({ unchanged: 1, changed: 1, added: 0, removed: 0 }));
  });

  it('starts fresh when no state was saved, or the state is damaged', async () => {
    const dir = makeFolder({ 'docs/settings.md': PUBLIC_DOC, '.knowledge-state.json': '{not json' });
    const { kb } = build({ dir, restore: true });
    expect(await kb.load()).toBe(false);
    const stats = await kb.sync({ directory: 'docs' });
    expect(stats.added).toBe(1);
  });

  it('does not save when persist is off', async () => {
    const dir = makeFolder({ 'docs/settings.md': PUBLIC_DOC });
    await build({ dir, persist: false }).kb.sync({ directory: 'docs' });
    expect(fs.existsSync(path.join(dir, '.knowledge-state.json'))).toBe(false);
  });
});

describe('HTML sources (feature 05)', () => {
  it('strips scripts, styles and tags, decodes entities, and reads the title', () => {
    const page = htmlToText('<html><head><title>Queue &amp; retries</title><style>p{}</style></head><body><script>alert(1)</script><h2>Retries</h2><p>Jobs retry &quot;3&quot; times.</p></body></html>');
    expect(page.title).toBe('Queue & retries');
    expect(page.text).toMatch(/## Retries/);
    expect(page.text).toMatch(/Jobs retry "3" times\./);
    expect(page.text).not.toMatch(/alert|style|<p>/);
  });

  it('indexes an HTML page and finds its text', async () => {
    const dir = makeFolder({ 'docs/faq.html': '<html><body><p>Backups run every night at midnight.</p></body></html>' });
    const { kb } = build({ dir });
    await kb.sync({ directory: 'docs' });
    const hits = await kb.retrieve('when do backups run');
    expect(hits[0].path).toBe('docs/faq.html');
  });
});

describe('evaluation harness (feature 05)', () => {
  it('reports recall and reciprocal rank for labelled questions', async () => {
    const dir = makeFolder({ 'docs/settings.md': PUBLIC_DOC, 'docs/faq.html': '<p>Backups run every night at midnight.</p>' });
    const { kb } = build({ dir });
    await kb.sync({ directory: 'docs' });
    const report = await evaluateRetrieval(kb, [
      { question: 'rotate the settings secret', expectedPath: 'docs/settings.md' },
      { question: 'when do backups run at night', expectedPath: 'docs/faq.html' },
      { question: 'something unrelated to anything', expectedPath: 'docs/missing.md' }
    ], { k: 3 });
    expect(report.cases).toBe(3);
    expect(report.recallAtK).toBeCloseTo(2 / 3);
    expect(report.meanReciprocalRank).toBeGreaterThan(0.6);
    expect(report.results[2].hit).toBe(false);
  });
});

describe('routes pass the caller roles (feature 05)', () => {
  it('a user does not see an admin-only document; an admin does', async () => {
    const dir = makeFolder({ 'docs/payroll.md': PRIVATE_DOC });
    const emitter = new EventEmitter();
    const app = express();
    app.use(express.json());
    const filing = createFiling('local', { baseDir: dir }, emitter);
    const searching = createSearching('vector', { embedding: { backend: 'hash', dimensions: 256 } }, emitter, {});
    const resolvePrincipal = async (req) => {
      const role = req.headers['x-test-role'];
      if (role === 'admin') return { principal: 'a', scopes: null, roles: ['admin'] };
      if (role === 'user') return { principal: 'u', roles: [], scopes: [] };
      return null;
    };
    createKnowledgeService('default', {
      'express-app': app,
      container: 'routes',
      access: () => ['admin'],
      resolvePrincipal,
      dependencies: { filing, searching, aiservice: stubAi(), logging: null }
    }, emitter);
    await request(app).post('/services/knowledge/api/sync').send({ directory: 'docs' }).expect(200);
    const user = await request(app).post('/services/knowledge/api/retrieve').set('x-test-role', 'user').send({ question: 'salary band grade seven' }).expect(200);
    expect(user.body.data).toEqual([]);
    const admin = await request(app).post('/services/knowledge/api/retrieve').set('x-test-role', 'admin').send({ question: 'salary band grade seven' }).expect(200);
    expect(admin.body.data[0].path).toBe('docs/payroll.md');
  });
});
