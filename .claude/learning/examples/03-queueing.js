'use strict';
// Example 03: the queueing service, plain and reliable.
const { registry, call, done } = require('./setup');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  // 'memory' is for development and tests. 'redis' is the shared option.
  const queue = registry.queue('memory');

  // Plain queue: first in, first out.
  await queue.enqueue('emails', { to: 'ada@example.com', template: 'welcome' });
  await queue.enqueue('emails', { to: 'grace@example.com', template: 'welcome' });
  console.log('waiting', await queue.size('emails'));

  const first = await queue.dequeue('emails');
  console.log('took', first);
  console.log('waiting after take', await queue.size('emails'));

  // Over REST: enqueue and check the size.
  await call('POST', '/services/queueing/api/enqueue/emails', { task: { to: 'linus@example.com' } });
  const size = await call('GET', '/services/queueing/api/size/emails');
  console.log('rest size', size.body);

  // Reliable jobs (memory and Redis only): retries, a dead-letter queue and
  // an idempotency key so a retried request does not enqueue twice.
  const options = {
    attempts: 3,
    backoff: { baseMs: 500, maxMs: 5000 },
    idempotencyKey: 'payment-INV-7',
  };
  const job = await queue.enqueue('payments', { invoice: 'INV-7' }, options);
  console.log('enqueued', job);

  // The same key again: the first job's id comes back, and nothing new is queued.
  const again = await queue.enqueue('payments', { invoice: 'INV-7' }, options);
  console.log('second enqueue returns the same job', again === job);

  // A consumer takes reliable jobs and runs the handler. Throwing fails the
  // job, which is retried after its backoff. Here the first attempt fails.
  let attemptsSeen = 0;
  const consumer = queue.process('payments', async (item) => {
    attemptsSeen += 1;
    if (attemptsSeen === 1) throw new Error('gateway timeout');
    console.log('charged', item.data.invoice, 'on attempt', item.attempts);
  }, { concurrency: 1, pollIntervalMs: 50 });

  // Wait for the retry to finish (the backoff is 500 ms).
  for (let i = 0; i < 100; i += 1) {
    const counts = await queue.jobCounts('payments');
    if (counts.completed >= 1) break;
    await wait(100);
  }
  await consumer.stop();
  console.log('counts', await queue.jobCounts('payments'));

  // Other providers (RabbitMQ, ActiveMQ, AWS, Azure, GCP, API) refuse these
  // options with a clear error instead of dropping them silently.

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
