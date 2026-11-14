/**
 * @fileoverview The knowledge service (feature 05) with the real AI Service v2
 * bridge on the scripted mock provider and hash embeddings: streamed answers and
 * the evaluation fixture (`tests/fixtures/knowledge/eval.yaml`). Runs under
 * node:test (npm run test:ai-common) because Jest cannot load the ES module the
 * bridge imports. No keys, no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const AICommon = require('../../../../src/aiservice/provider/aiCommon');
const { KnowledgeBase } = require('../../../../src/knowledge/providers/knowledge');
const createFiling = require('../../../../src/filing');
const createSearching = require('../../../../src/searching');
const { testDataDir } = require('../../../helpers/testData');

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '../../../fixtures/knowledge');
const dirs = [];

function knowledgeBase(script) {
  const dir = fs.mkdtempSync(path.join(testDataDir('knowledge-node'), 'kb-'));
  fs.cpSync(path.join(FIXTURES, 'docs'), path.join(dir, 'docs'), { recursive: true });
  dirs.push(dir);
  const emitter = new EventEmitter();
  const filing = createFiling('local', { baseDir: dir }, emitter);
  const searching = createSearching('vector', { embedding: { backend: 'hash', dimensions: 256 } }, emitter, {});
  const aiservice = new AICommon({ script, model: 'mock' }, emitter, { providerId: 'mock' });
  return new KnowledgeBase({ filing, searching, aiservice }, { container: `kb-${Math.random()}`, topK: 3 }, emitter);
}

after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

test('streams a cited answer through the mock provider, piece by piece', async () => {
  const kb = knowledgeBase([{ text: 'Set a new SETTINGS_SECRET and restart the app [1].' }]);
  await kb.sync({ directory: 'docs' });
  const events = [];
  for await (const event of kb.streamAnswer('How do I rotate the settings secret?', { roles: ['*'] })) events.push(event);
  assert.equal(events[0].type, 'sources');
  assert.equal(events[0].sources[0].path, 'docs/settings.md');
  const pieces = events.filter((e) => e.type === 'text');
  assert.ok(pieces.length > 3, 'the mock streams in small pieces');
  const done = events.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.text, 'Set a new SETTINGS_SECRET and restart the app [1].');
  assert.equal(done.confidence, 'cited');
  assert.equal(done.citations[0].path, 'docs/settings.md');
  assert.ok(done.usage, 'usage comes from the final message event');
});

test('scores the evaluation fixture with the mock provider: every file found and cited', async () => {
  const yamlText = fs.readFileSync(path.join(FIXTURES, 'eval.yaml'), 'utf8');
  const kb = knowledgeBase(Array.from({ length: 3 }, () => ({ text: 'It is in the first source [1].' })));
  await kb.sync({ directory: 'docs' });
  const report = await kb.evaluate(yamlText, { k: 3, answers: true });
  assert.equal(report.cases, 3);
  assert.equal(report.recallAtK, 1);
  assert.equal(report.meanReciprocalRank, 1);
  assert.equal(report.citationAccuracy, 1);
});
