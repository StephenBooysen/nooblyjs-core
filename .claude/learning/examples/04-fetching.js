'use strict';
// Example 04: the fetching service (HTTP requests with a response cache).
const { registry, done } = require('./setup');

(async () => {
  // 'node' uses Node's built-in fetch. 'axios' uses Axios, if installed.
  const fetching = registry.fetching('node');

  // Every request goes through the SSRF guard. A private or loopback address
  // is refused before any connection is made.
  try {
    await fetching.fetch('http://127.0.0.1:9/internal');
  } catch (err) {
    console.log('private address refused:', err.message.split(':')[0]);
  }

  // A public address: a successful GET is cached for `next.revalidate`
  // seconds, so the second call is answered from the cache. This needs
  // internet access, so the example reports either outcome.
  try {
    const response = await fetching.fetch('https://example.com/', { next: { revalidate: 60 } });
    console.log('public status', response.status);
    await fetching.fetch('https://example.com/', { next: { revalidate: 60 } });
    console.log('analytics', fetching.getAnalytics());
  } catch (err) {
    console.log('public request not made:', err.message);
  }

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
