// Phase 1 APIs: AI Service v2, reliable jobs, scoped keys, validated options.
import registry = require('nooblyjs-core');

async function main(): Promise<void> {
  registry.initialize({ use() {}, get() {}, post() {} }, null, {
    strictOptions: true,
    security: { apiKeyAuth: { apiKeys: ['plain', { key: 'k', name: 'worker', scopes: ['queue:*'] }] }, roles: { auditor: ['log:read'] } },
  });

  // AI Service v2
  const ai = registry.aiservice('anthropic', { model: 'claude-sonnet-5-5', maxCostPerDay: 5 });
  const reply = await ai.complete({ system: 'Be brief', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 300 });
  const cost: number = reply.cost;
  void cost;
  for await (const event of ai.stream({ prompt: 'Tell me a story' })) {
    if (event.type === 'text_delta') process.stdout.write(event.text);
  }
  const { object } = await ai.generateObject<{ name: string }>({ prompt: 'Who?', schema: { type: 'object' } });
  object.name.toLowerCase();
  const vectors: number[][] = await ai.embed(['one', 'two'], { dimensions: 768 });
  void vectors;
  const v2 = registry.aiservice('claude', { legacy: false });
  await v2.complete({ prompt: 'x' });
  const legacy = registry.aiservice('claude', { apiKey: 'k' });
  // @ts-expect-error legacy providers have no complete()
  legacy.complete;

  // Reliable jobs
  const queue = registry.queue('redis', { redisUrl: 'localhost', jobs: { attempts: 5 } });
  const id: string = await queue.enqueue('emails', { to: 'a' }, { delayMs: 60_000, attempts: 5, backoff: { type: 'exponential', baseMs: 1000 }, idempotencyKey: 'w:1', priority: 'high' });
  const plain: void = await queue.enqueue('emails', { to: 'b' });
  void plain;
  const consumer = queue.process<{ to: string }>('emails', async (job) => { job.data.to.trim(); }, { concurrency: 4 });
  const job = await queue.getJob(id);
  if (job) job.state satisfies 'waiting' | 'delayed' | 'active' | 'completed' | 'failed' | 'dead';
  await queue.retryDeadLetters('emails');
  await consumer.stop();
  // @ts-expect-error unknown priority
  await queue.enqueue('emails', {}, { priority: 'urgent' });

  // Typed options
  // @ts-expect-error unknown provider name
  registry.cache('memcache');
  registry.cache('redis', { redisUrl: 'localhost' });
  // @ts-expect-error wrong option type
  registry.cache('file', { cacheDir: 5 });

  const working = registry.working('memory');
  await working.start('task.js', {}, (status) => status satisfies 'completed' | 'error', { attempts: 3 });
  registry.verifyRoutePermissions({ strict: true });
  await registry.shutdown();
}
void main;
