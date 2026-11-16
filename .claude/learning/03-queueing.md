# 03: Queueing

**Time:** about 20 minutes · **Example:** [`examples/03-queueing.js`](examples/03-queueing.js) · **Run:** `node .claude/learning/examples/03-queueing.js`

## What you will learn

Put work on a named queue, take it off in order, and use reliable jobs with retries, a dead-letter queue and idempotency keys.

## Key ideas

- **A queue holds messages until a consumer takes them.** The producer enqueues; the consumer dequeues. Neither needs to know about the other.
- **Named queues.** `emails` and `payments` are separate queues in the same service.
- **First in, first out.** `dequeue` returns the oldest waiting message.
- **Reliable jobs.** A job can be retried with backoff, moved to a dead-letter queue after its last attempt, and enqueued once per idempotency key. This is at-least-once delivery: a job may run again after a crash, so make consumers idempotent.
- **Providers.** `memory` and `redis` support reliable jobs. `rabbitmq`, `activemq`, `aws`, `azure`, `gcp` and `api` refuse the reliable options with a clear error rather than dropping them.

## Walk-through

### Plain queue

```javascript
const queue = registry.queue('memory');

await queue.enqueue('emails', { to: 'ada@example.com', template: 'welcome' });
await queue.enqueue('emails', { to: 'grace@example.com', template: 'welcome' });
console.log(await queue.size('emails'));          // 2

const first = await queue.dequeue('emails');      // Ada's message
console.log(await queue.size('emails'));          // 1
```

### Reliable job

```javascript
await queue.enqueue('payments', { invoice: 'INV-7' }, {
  attempts: 3,
  backoff: { baseMs: 500, maxMs: 5000 },
  idempotencyKey: 'payment-INV-7',
});
```

- `attempts` is the number of tries, from 1 to 100.
- `backoff` waits longer after each failure, doubling from `baseMs` up to `maxMs`.
- `idempotencyKey` makes a second enqueue with the same key return the first job's id and add nothing, so a retried HTTP request does not charge twice. The key is remembered for `dedupeWindowMs`, 24 hours by default.
- `delayMs`, `priority` and `dedupeWindowMs` are also accepted.

### A consumer

Reliable jobs are taken by a consumer. The handler runs once per job; throwing from it fails the job.

```javascript
const consumer = queue.process('payments', async (job) => {
  // job.id, job.data, job.attempts and job.maxAttempts describe this delivery.
  await chargeCard(job.data.invoice);   // throw to fail; a retry follows
}, { concurrency: 2, visibilityTimeoutMs: 30000 });

// later, when the process shuts down:
await consumer.stop();
```

- A failed job waits for its backoff, then runs again, until `attempts` is used up. After the last failure it moves to the dead-letter queue.
- `queue.jobCounts('payments')` reports waiting, delayed, active, completed and dead jobs. `queue.retryDeadLetters('payments')` puts dead jobs back with their attempts reset.
- A job is taken on a lease of `visibilityTimeoutMs` (30 seconds by default). If the handler is still running when the lease ends, the job is delivered again to another consumer. This is why delivery is at least once.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/queueing/api/enqueue/:queueName` | Add `{ task }` to a queue |
| GET | `/services/queueing/api/dequeue/:queueName` | Take the next message |
| GET | `/services/queueing/api/size/:queueName` | Messages waiting |
| GET | `/services/queueing/api/queues` | Queue names |
| POST | `/services/queueing/api/queues/:queueName/jobs` | Enqueue a reliable job (`task`, `options`) |
| GET | `/services/queueing/api/queues/:queueName/jobs/:jobId` | Read a job |
| GET | `/services/queueing/api/queues/:queueName/job-counts` | Waiting, active, completed, dead |
| POST | `/services/queueing/api/queues/:queueName/retry-dead` | Put dead jobs back |
| DELETE | `/services/queueing/api/purge/:queueName` | Empty a queue |

## Providers

| Type | Use it for | Reliable jobs |
|---|---|---|
| `memory` | Development and tests | Yes, in process |
| `redis` | Shared queues for several instances | Yes, stored in Redis; set the host with `redisurl` |
| `rabbitmq`, `activemq` | Existing message brokers | No (refused with a 400) |
| `aws`, `azure`, `gcp` | Cloud queues | No (refused with a 400) |
| `api` | A remote queueing service | No (refused with a 400) |

## Common mistakes

- **Assuming exactly-once delivery.** A job runs again if its handler is still going when the visibility timeout ends, or if a worker crashes after doing the work but before it finishes. Use an idempotency key or make the work safe to repeat.
- **Enqueuing without a consumer.** Messages wait forever. Check `size` in monitoring, or add a consumer with the working or scheduling service.
- **Sending large payloads.** Put the big data in filing or the data service and enqueue its key.
- **Using `memory` in production.** A restart loses every waiting message.
- **Passing reliable options to a provider that refuses them.** You get a 400 at enqueue time. That is deliberate: choose a supported provider rather than losing retries silently.

## Try it

1. Enqueue three messages, dequeue two, and check `size` after each step.
2. Enqueue the same job twice with one `idempotencyKey`. Check that only one job is waiting.
3. Change the example to use a queue name that is not in use and check `listQueues()`.
