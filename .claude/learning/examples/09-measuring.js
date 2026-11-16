'use strict';
// Example 09: the measuring service: numbers recorded over time.
const { registry, call, done } = require('./setup');

(async () => {
  const measuring = registry.measuring('default');

  // Record measures as they happen: a request count, a response time.
  measuring.add('visits', 1);
  measuring.add('visits', 1);
  measuring.add('visits', 3);
  measuring.add('response-ms', 120);
  measuring.add('response-ms', 80);

  // Omit the dates to cover all time.
  console.log('total visits', measuring.total('visits'));
  console.log('average response', measuring.average('response-ms'));

  // Or ask for a period. Dates are inclusive.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const now = new Date();
  console.log('visits in the last hour', measuring.total('visits', hourAgo, now));
  console.log('the measures themselves', measuring.list('visits').map((m) => m.value));

  // Over REST. The dates are part of the path and must be ISO dates.
  const from = encodeURIComponent(hourAgo.toISOString());
  const to = encodeURIComponent(now.toISOString());
  const added = await call('POST', '/services/measuring/api/add', { metric: 'visits', value: 2 });
  console.log('rest add', added.status);
  const total = await call('GET', `/services/measuring/api/total/visits/${from}/${to}`);
  console.log('rest total', total.status, total.body);

  // A date that is not a date is refused, rather than reported as zero.
  const bad = await call('GET', '/services/measuring/api/total/visits/yesterday/' + to);
  console.log('rest bad date', bad.status, bad.body.error);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
