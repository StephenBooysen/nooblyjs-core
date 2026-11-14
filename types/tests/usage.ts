// Compiled with `strict: true` by `npm run check:types`. Each line is a usage the
// declarations must accept; the @ts-expect-error lines must be rejected.
import registry from '../index';

registry.initialize({}, undefined, { strictOptions: true });

async function run(): Promise<void> {
  const cache = registry.cache('redis', { redisUrl: 'redis://localhost:6379' });
  await cache.put('k', { a: 1 });
  const value = await cache.get<{ a: number }>('k');
  const n: number | undefined = value?.a;
  void n;

  const queue = registry.queue('memory');
  await queue.enqueue('emails', { to: 'a@example.com' });
  const size: number = await queue.size('emails');
  void size;

  const log = registry.logger('file', { minLogLevel: 'info' });
  log.info('started', { port: 9000 });

  const data = registry.dataService('mongodb', { connectionString: 'mongodb://x', database: 'app' });
  const container = await data.createContainer('users');
  await container.add({ name: 'Ada' });

  const files = registry.filing('s3', { bucketName: 'b', region: 'eu-west-1' });
  await files.list('/');

  const jobId: string = await queue.enqueue('emails', { to: 'a@example.com' }, { attempts: 5, idempotencyKey: 'welcome-1' });
  const consumer = queue.process<{ to: string }>('emails', async (job) => job.data.to);
  await consumer.stop();
  void jobId;

  const ai = registry.aiservice('anthropic', { model: 'claude-sonnet-5-5', budgets: { maxCostPerDay: 5 }, embeddings: { provider: 'openai' } });
  const reply = await ai.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
  const text: string = reply.text;
  const { vectors } = await ai.embed(['one', 'two'], { dimensions: 256 });
  const width: number = vectors[0].length;
  void text; void width;

  const modern = registry.aiservice('openai', { legacy: false });
  await modern.embed('x');
  const old = registry.aiservice('claude', { apiKey: 'k' });
  await old.prompt('hi');

  const auth = registry.authservice('file', { sessionIdleTimeoutMs: { admin: 600000 } });
  const token = await auth.createApiToken('a@example.com', 'ci', { expiresInDays: 30, scopes: ['queueing:*'] });
  const secret: string = token.token;
  void secret;

  // @ts-expect-error: the option is scopes, not permissions
  await auth.createApiToken('a@example.com', 'ci', { permissions: ['queueing:*'] });

  const kb = registry.knowledge('default', { container: 'docs', access: (p) => (p.startsWith('internal/') ? ['support'] : ['*']), watch: true });
  await kb.sync({ directory: 'docs' });
  const answer = await kb.ask('How do I rotate the settings secret?', { roles: ['support'] });
  const firstSource: string | undefined = answer.citations[0]?.path;
  void firstSource;
  for await (const event of kb.streamAnswer('What happens after the last retry?')) {
    if (event.type === 'text') { const piece: string = event.text; void piece; }
    if (event.type === 'done') void event.confidence;
  }
  const report = await kb.evaluate('- question: q\n  expectedPath: docs/a.md\n', { k: 3, answers: true });
  void report.recallAtK;

  // @ts-expect-error: a rating is good or bad
  await kb.recordFeedback({ question: 'q', rating: 'meh' });

  // @ts-expect-error: a legacy AI provider has no embed()
  await old.embed('x');

  // @ts-expect-error: Google sign-in needs a client id and secret
  registry.authservice('google', {});

  // @ts-expect-error: unknown provider name
  registry.cache('redus');

  // @ts-expect-error: S3 filing needs a bucket and a region
  registry.filing('s3', {});

  // @ts-expect-error: the minimum log level is a fixed set
  registry.logger('file', { minLogLevel: 'verbose' });
}

void run;
