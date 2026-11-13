/**
 * @fileoverview Tests for the CommonJS bridge to the shared AI module (feature 02).
 * Runs under node:test (npm run test:ai-common), because Jest cannot load the
 * ES module the bridge imports. Uses the scripted mock provider: no keys, no network.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import EventEmitter from 'node:events';

// This folder is an ES module package; the bridge and the repo's packages are CommonJS.
const require = createRequire(import.meta.url);
const express = require('express');
const request = require('supertest');
const AICommon = require('../../../../src/aiservice/provider/aiCommon');
const createAI = require('../../../../src/aiservice');

const mock = (script, options = {}) => new AICommon({ script, model: 'mock', ...options }, new EventEmitter(), { providerId: 'mock' });
const user = (content) => [{ role: 'user', content }];

test('prompt() keeps the legacy return shape', async () => {
  const reply = await mock([{ text: 'hello there' }]).prompt('hi');
  assert.equal(reply.content, 'hello there');
  assert.equal(reply.provider, 'mock');
  assert.equal(reply.model, 'mock');
  assert.ok(reply.usage);
});

test('complete() returns text, tool calls and the stop reason', async () => {
  const ai = mock([{ text: 'Let me look.', tools: [{ name: 'Read', input: { file_path: 'a.txt' } }] }]);
  const reply = await ai.complete({ messages: user('read a.txt') });
  assert.equal(reply.text, 'Let me look.');
  assert.equal(reply.toolCalls[0].name, 'Read');
  assert.deepEqual(reply.toolCalls[0].input, { file_path: 'a.txt' });
  assert.equal(reply.stopReason, 'tool_use');
});

test('generateObject() parses fenced JSON that matches the schema', async () => {
  const ai = mock([{ text: '```json\n{"name":"Ada","age":36}\n```' }]);
  const value = await ai.generateObject({
    messages: user('who'),
    schema: { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string' }, age: { type: 'number' } } }
  });
  assert.deepEqual(value, { name: 'Ada', age: 36 });
});

test('generateObject() refuses invalid JSON and mismatched objects with 422', async () => {
  const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
  await assert.rejects(
    mock([{ text: 'not json' }]).generateObject({ messages: user('x'), schema }),
    (err) => err.statusCode === 422
  );
  await assert.rejects(
    mock([{ text: '{"name": 5}' }]).generateObject({ messages: user('x'), schema }),
    /should be string/
  );
});

test('refuses a request above the token limit with 429', async () => {
  const ai = mock([{ text: 'ok' }], { budgets: { maxTokensPerRequest: 100 } });
  await assert.rejects(ai.complete({ messages: user('x'), maxTokens: 500 }), (err) => err.statusCode === 429);
});

test('refuses requests once the daily cost budget is used up', async () => {
  const ai = mock([{ text: 'ok' }], { budgets: { maxCostPerDay: 0 } });
  await assert.rejects(ai.complete({ messages: user('x') }), (err) => err.statusCode === 429);
});

test('reports embeddings as unavailable for Anthropic with a 501', async () => {
  const ai = new AICommon({}, null, { providerId: 'anthropic' });
  await assert.rejects(ai.embed(['a']), (err) => err.statusCode === 501);
});

test('streams a reply to a client as server-sent events', async () => {
  const ai = mock([{ text: 'streamed reply' }]);
  const app = express();
  app.use(express.json());
  app.post('/s', (req, res) => ai.streamToResponse(res, req.body));
  const res = await request(app)
    .post('/s')
    .send({ messages: user('go') })
    .buffer(true)
    .parse((r, cb) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => cb(null, d)); })
    .expect(200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  // The mock streams a few characters per event, so join the text from every event.
  const texts = [...res.body.matchAll(/event: text\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]).text);
  assert.equal(texts.join(''), 'streamed reply');
  assert.match(res.body, /event: done/);
});

test('the factory keeps legacy names on their old classes and gives shared names the bridge', () => {
  const legacy = createAI('claude', { apiKey: 'x' }, new EventEmitter());
  assert.equal(typeof legacy.complete, 'undefined');
  const shared = createAI('mock', { script: [{ text: 'hi' }] }, new EventEmitter());
  assert.equal(typeof shared.complete, 'function');
});
