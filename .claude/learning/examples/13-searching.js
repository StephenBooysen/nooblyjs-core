'use strict';
// Example 13: the searching service: full-text search with ranking, suggestions and snippets.
const { registry, call, done } = require('./setup');

(async () => {
  // 'memory' keeps the index in process. 'vector' and 'semantic' add
  // embeddings from the AI service for meaning-based search.
  const search = registry.searching('memory');

  // Index documents. The key identifies the document; the object is searched.
  await search.add('policy-returns', {
    title: 'Returns policy',
    body: 'You can return an item within 30 days with your receipt.',
  });
  await search.add('policy-shipping', {
    title: 'Shipping',
    body: 'Orders ship within two business days. Delivery takes three to five days.',
  });
  await search.add('faq-passwords', {
    title: 'Password help',
    body: 'Reset your password from the sign-in page.',
  });

  // Search by words. Results come back ranked by relevance.
  const hits = await search.search('return receipt');
  console.log('hits', hits.map((hit) => `${hit.key} (${hit.score.toFixed(2)})`));

  // Suggestions for a partial word, for search boxes.
  console.log('suggest "ship"', await search.suggest('ship'));

  // Over REST: search with a term in the path. Matching is by whole word, so
  // 'password' finds the document and 'passwords' does not.
  const found = await call('GET', '/services/searching/api/search/password');
  console.log('rest search', found.status, Array.isArray(found.body) ? found.body.map((h) => h.key) : found.body);

  // Remove a document; it no longer appears in results.
  await search.remove('faq-passwords');
  console.log('after remove', (await search.search('password')).length);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
