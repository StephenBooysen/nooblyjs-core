/**
 * @fileoverview Contract every AI Service v2 provider must pass (feature 11),
 * run on the scripted mock provider so it needs no keys. To hold a real provider
 * to the same contract, set AI_CONTRACT_PROVIDER (for example `anthropic` or
 * `openai`) and that provider's key (ANTHROPIC_API_KEY, OPENAI_API_KEY); those
 * runs make real, billed requests. Runs under node:test (npm run test:ai-common).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import EventEmitter from 'node:events';

const require = createRequire(import.meta.url);
const AICommon = require('../../../../src/aiservice/provider/aiCommon');

const KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };
const providers = [{ id: 'mock', make: () => new AICommon({ model: 'mock', script: Array.from({ length: 10 }, () => ({ text: 'pong' })) }, new EventEmitter(), { providerId: 'mock' }) }];
const live = process.env.AI_CONTRACT_PROVIDER;
if (live && process.env[KEYS[live]]) {
  providers.push({ id: live, make: () => new AICommon({ apiKey: process.env[KEYS[live]] }, new EventEmitter(), { providerId: live }) });
}

for (const { id, make } of providers) {
  const ask = [{ role: 'user', content: 'Reply with the single word: pong' }];

  test(`${id}: complete() returns text, usage and a stop reason`, async () => {
    const reply = await make().complete({ messages: ask, maxTokens: 20 });
    assert.equal(typeof reply.text, 'string');
    assert.match(reply.text.toLowerCase(), /pong/);
    assert.ok(reply.usage && typeof reply.usage === 'object');
    assert.ok('stopReason' in reply);
  });

  test(`${id}: stream() yields text deltas that add up to the reply, then a message`, async () => {
    let text = '';
    let message = null;
    for await (const event of make().stream({ messages: ask, maxTokens: 20 })) {
      if (event.type === 'text_delta') text += event.text;
      if (event.type === 'message') message = event.message;
    }
    assert.match(text.toLowerCase(), /pong/);
    assert.ok(message, 'a final message event');
  });

  test(`${id}: prompt() keeps the legacy shape`, async () => {
    const reply = await make().prompt('Reply with the single word: pong', { maxTokens: 20 });
    assert.equal(typeof reply.content, 'string');
    assert.equal(reply.provider, id);
    assert.ok(reply.usage);
  });

  test(`${id}: refuses a request above the per-request token budget with 429`, async () => {
    const ai = new AICommon({ model: 'mock', script: [{ text: 'x' }], budgets: { maxTokensPerRequest: 10 } }, new EventEmitter(), { providerId: 'mock' });
    await assert.rejects(ai.complete({ messages: ask, maxTokens: 100 }), (err) => err.statusCode === 429);
  });
}
