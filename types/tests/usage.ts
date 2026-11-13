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

  // @ts-expect-error: unknown provider name
  registry.cache('redus');

  // @ts-expect-error: S3 filing needs a bucket and a region
  registry.filing('s3', {});

  // @ts-expect-error: the minimum log level is a fixed set
  registry.logger('file', { minLogLevel: 'verbose' });
}

void run;
