'use strict';
// Example 02: the caching service.
const { registry, call, done } = require('./setup');

(async () => {
  // 'memory' is a per-process cache. 'redis' shares the cache between
  // instances; it needs REDIS_URL. The API is the same for both.
  const cache = registry.cache('memory');

  // Store a value, then read it back.
  await cache.put('greeting', { text: 'hello' });
  console.log('local get', await cache.get('greeting'));

  // Delete it; reading a missing key returns undefined.
  await cache.delete('greeting');
  console.log('after delete', await cache.get('greeting'));

  // The same operations over REST.
  await call('POST', '/services/caching/api/put/visits', { value: 41 });
  const got = await call('GET', '/services/caching/api/get/visits');
  console.log('rest get', got.status, got.body);

  // Named instances keep separate caches, for example sessions and data.
  const sessions = registry.cache('memory', { instanceName: 'sessions' });
  await sessions.put('user:ada', { role: 'admin' });
  console.log('sessions instance', await sessions.get('user:ada'));
  console.log('default instance has it?', (await cache.get('user:ada')) !== undefined);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
