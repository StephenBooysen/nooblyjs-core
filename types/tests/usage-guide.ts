// Every example in the concise usage guide, compiled with strict: true.
import serviceRegistry from 'nooblyjs-core';
import { EventEmitter } from 'node:events';

declare const app: { use(...a: any[]): unknown; get(...a: any[]): unknown; post(...a: any[]): unknown; listen(port: number | string): unknown };
declare function sendEmail(job: unknown): Promise<void>;
declare const sessionToken: string;
declare const text: string;

async function main(): Promise<void> {
  serviceRegistry.initialize(app, new EventEmitter(), {
    security: {
      apiKeyAuth: { apiKeys: (process.env.NOOBLYJS_API_KEYS || '').split(',').filter(Boolean), requireApiKey: true },
      servicesAuth: { requireLogin: true },
    },
  });

  const logger = serviceRegistry.logger('file');
  const cache = serviceRegistry.cache('redis');
  const dataStore = serviceRegistry.dataService('file');
  const queue = serviceRegistry.queue('redis');
  const workflow = serviceRegistry.workflow('memory');
  const scheduler = serviceRegistry.scheduling('memory');
  const search = serviceRegistry.searching('memory');
  serviceRegistry.working('memory');
  const auth = serviceRegistry.authservice('file');
  const ai = serviceRegistry.aiservice('claude');
  const filing = serviceRegistry.filing('local');
  serviceRegistry.cache('redis', { instanceName: 'sessions' });

  await cache.put('user:42', { name: 'Ada' });
  const user = await cache.get<{ name: string }>('user:42');
  const name: string | undefined = user?.name;
  void name;
  await cache.delete('user:42');

  await dataStore.createContainer('orders');
  const uuid = await dataStore.add('orders', { total: 40 });
  const order = await dataStore.getByUuid<{ total: number }>('orders', uuid);
  if (order) order.total.toFixed(2);
  await dataStore.update('orders', uuid, { total: 45 });
  await dataStore.remove('orders', uuid);
  await dataStore.listAll('orders');
  await dataStore.find('orders', 'Ada');
  const count: number = await dataStore.count('orders');
  void count;

  await queue.enqueue('emails', { to: 'ada@example.com' });
  const next = await queue.dequeue('emails');
  if (next) await sendEmail(next);
  const depth: number = await queue.size('emails');
  void depth;
  await queue.listQueues();
  await queue.purge('emails');

  await workflow.defineWorkflow('order-flow', ['validate.js', 'charge.js', 'notify.js']);
  await workflow.runWorkflow('order-flow', { orderId: 123 }, (status) => logger.info('Workflow status', { status }));
  await scheduler.startCron({ scriptPath: 'nightly-cleanup.js' }, '0 2 * * *', 'nightly-cleanup');

  await search.add('doc-1', { title: 'Install guide', content: 'Run npm install' });
  await search.search('install');

  await auth.createUser({ email: 'ada@example.com', fullName: 'Ada Lovelace', password: 'use-a-strong-password', role: 'user' });
  await auth.authenticateUser('ada@example.com', 'use-a-strong-password');
  await auth.validateSession(sessionToken);
  await auth.logout(sessionToken);
  const created = await auth.createApiToken('ada@example.com', 'ci-token');
  await auth.validateApiToken(created.token);

  await filing.create('reports/summary.txt', 'Hello');
  await filing.read('reports/summary.txt', 'utf8');
  await filing.update('reports/summary.txt', 'Updated');
  await filing.list('reports');
  await filing.delete('reports/summary.txt');

  const answer = await ai.prompt('What is machine learning?');
  answer.content.toUpperCase();
  await ai.prompt(text, { maxTokens: 500, temperature: 0.7 });

  serviceRegistry.getEventEmitter().on('cache:put', () => undefined);
  serviceRegistry.listServices();
  serviceRegistry.listInstances('caching');
  serviceRegistry.setDefaultProvider('queueing', 'redis');
  serviceRegistry.resetService('caching');
  serviceRegistry.generateApiKey(32);
  serviceRegistry.validateDependencies();
  serviceRegistry.reset();
}
void main;
