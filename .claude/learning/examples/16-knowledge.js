'use strict';
// Example 16: the knowledge service: answers with citations over your documents.
const fs = require('node:fs');
const path = require('node:path');
const { registry, call, done, dataDir } = require('./setup');

(async () => {
  // Knowledge reads documents from a filing store, so set one up first.
  const baseDir = path.join(dataDir, 'knowledge-16');
  const filing = registry.filing('local', { baseDir });
  await filing.create('policies/returns.md', [
    '# Returns',
    '',
    'You can return an item within 30 days with your receipt.',
    '',
    '# Refunds',
    '',
    'Refunds go back to the card used for the purchase within five working days.',
  ].join('\n'));
  await filing.create('policies/shipping.md', 'Orders ship within two business days.');

  // The AI service answers. 'mock' gives a placeholder answer, so the
  // citations below stay empty; use a real provider for real answers.
  const aiservice = registry.aiservice('mock', {});

  // Build the knowledge service over the filing store and the AI service.
  const knowledge = registry.knowledge('default', {
    dependencies: { filing, aiservice },
    persist: false,
  });

  // Index the files. Only new or changed files are read again next time.
  const summary = await knowledge.sync({ directory: '/' });
  console.log('sync', summary);

  // Ask a question. The answer names the sources it used by number.
  const answer = await knowledge.ask('How long do I have to return an item?', { k: 3 });
  console.log('answer', answer.text);
  console.log('confidence', answer.confidence, 'citations', answer.citations.length);

  // Over REST: the same questions, and the list of indexed sources.
  const sources = await call('GET', '/services/knowledge/api/sources');
  console.log('rest sources', sources.status);
  const ask = await call('POST', '/services/knowledge/api/ask', { question: 'Refund timing?' });
  console.log('rest ask', ask.status);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
