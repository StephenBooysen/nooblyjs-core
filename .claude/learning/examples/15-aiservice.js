'use strict';
// Example 15: the aiservice service: one API for model providers.
const { registry, call, done } = require('./setup');

(async () => {
  // 'mock' answers without a network call, so this example runs anywhere.
  // Switch to 'anthropic', 'openai-compatible', 'bedrock', 'vertex' or 'azure'
  // and set that provider's key (see the tutorial) to call a real model.
  const ai = registry.aiservice('mock', {
    // The replies the mock gives, in order: one per model call below.
    script: [
      { text: 'You have 30 days to return an item.' },
      { text: '{"window_days": 30}' },
      { text: 'Hello from the mock provider.' },
    ],
    // Limits. A request over either limit is refused before it is sent.
    budgets: { maxTokensPerRequest: 1000, maxCostPerDay: 5 },
  });

  // One reply, with the text and the token usage.
  const reply = await ai.complete({
    system: 'You answer in one short sentence.',
    messages: [{ role: 'user', content: 'What is the returns window?' }],
    maxTokens: 200,
  });
  console.log('reply text', reply.text);
  console.log('usage', reply.usage);

  // Structured output: ask for JSON that follows a schema.
  try {
    const object = await ai.generateObject({
      schema: { type: 'object', properties: { window_days: { type: 'number' } } },
      messages: [{ role: 'user', content: 'How many days is the returns window?' }],
      maxTokens: 200,
    });
    console.log('object', object);
  } catch (err) {
    // A reply that is not JSON is refused with a 422.
    console.log('object refused:', err.message);
  }

  // Embeddings turn text into vectors for search. Mock vectors are fake but
  // have the right shape.
  const { vectors, model } = await ai.embed(['returns policy', 'shipping times']);
  console.log('vectors', vectors.length, 'of length', vectors[0]?.length, 'model', model);

  // Over REST: the same call, with the learning key.
  const rest = await call('POST', '/services/ai/api/complete', {
    messages: [{ role: 'user', content: 'Say hello' }],
    maxTokens: 200,
  });
  console.log('rest complete', rest.status);
  const models = await call('GET', '/services/ai/api/models');
  console.log('rest models', models.status);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
