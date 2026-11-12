# NooblyJS Core - Concise Usage Guide

Quick reference for using NooblyJS Core in an application. Method names match the provider classes in `src/*/providers/`. Where an option is provider-specific, check the service's `index.js` for the full list.

## Basic Setup

```javascript
const serviceRegistry = require('nooblyjs-core');   // singleton ServiceRegistry
const express = require('express');
const { EventEmitter } = require('events');

const app = express();
const eventEmitter = new EventEmitter();

serviceRegistry.initialize(app, eventEmitter, {
  security: {
    apiKeyAuth: {
      apiKeys: (process.env.NOOBLYJS_API_KEYS || '').split(',').filter(Boolean),
      requireApiKey: true,
    },
    servicesAuth: {
      requireLogin: true,   // /services/* needs an authenticated admin session
    },
  },
});

app.listen(process.env.PORT || 9000);
```

`initialize()` must be called once, before any service is requested. Calling it again is a no-op.

## Getting Services

```javascript
// Single-line access. The first argument is the provider type.
const logger    = serviceRegistry.logger('file');
const cache     = serviceRegistry.cache('redis');
const dataStore = serviceRegistry.dataService('file');
const queue     = serviceRegistry.queue('redis');
const workflow  = serviceRegistry.workflow('memory');
const scheduler = serviceRegistry.scheduling('memory');
const search    = serviceRegistry.searching('memory');
const working   = serviceRegistry.working('memory');
const auth      = serviceRegistry.authservice('file');
const ai        = serviceRegistry.aiservice('claude');
const filing    = serviceRegistry.filing('local');

// Multiple named instances of the same service
const sessionCache = serviceRegistry.cache('redis', { instanceName: 'sessions' });
const dataCache    = serviceRegistry.cache('redis', { instanceName: 'data' });
```

## Common Operations

### Logging

```javascript
logger.info('Order placed', { orderId: 123 });
logger.warn('Slow response', { ms: 850 });
logger.error('Payment failed', { error: err.message });
logger.debug('Details', { payload });
```

### Caching

```javascript
await cache.put('user:42', { name: 'Ada' });
const user = await cache.get('user:42');
await cache.delete('user:42');
const stats = cache.getAnalytics();
```

### Data Operations

```javascript
await dataStore.createContainer('orders');
const uuid = await dataStore.add('orders', { total: 40 });   // returns the new record's uuid
const order = await dataStore.getByUuid('orders', uuid);     // null when not found
await dataStore.update('orders', uuid, { total: 45 });
await dataStore.remove('orders', uuid);

const all    = await dataStore.listAll('orders');
const hits   = await dataStore.find('orders', 'Ada');        // search term
const count  = await dataStore.count('orders');
```

### Queueing

```javascript
await queue.enqueue('emails', { to: 'ada@example.com' });
const next = await queue.dequeue('emails');   // empty when the queue has nothing waiting
const depth = await queue.size('emails');
const names = await queue.listQueues();
await queue.purge('emails');
```

Queues are not consumed by a callback. Read them from a worker loop, or hand background work to the Working service:

```javascript
setInterval(async () => {
  const job = await queue.dequeue('emails');
  if (job) await sendEmail(job);
}, 1000);
```

### Background Work (Working Service)

```javascript
// Runs a script in a worker. The completion callback receives the result.
working.start('./activities/resize-image.js', { file: 'a.png' }, (status, data) => {
  logger.info('Resize finished', { status, data });
});
```

### Workflows

A workflow is a named list of step scripts. Each step runs in order and receives the output of the step before it.

```javascript
await workflow.defineWorkflow('order-flow', ['validate.js', 'charge.js', 'notify.js']);

await workflow.runWorkflow(
  'order-flow',
  { orderId: 123 },
  (status) => logger.info('Workflow status', { status }),
);
```

### Scheduling

```javascript
// Run a script on a 5-field cron expression. Task name is the last argument.
await scheduler.startCron({ scriptPath: 'nightly-cleanup.js' }, '0 2 * * *', 'nightly-cleanup');
```

### Search

```javascript
await search.add('doc-1', { title: 'Install guide', content: 'Run npm install' });   // resolves false if the key exists
const results = await search.search('install');                                   // array of matching documents
```

### Authentication

```javascript
const user = await auth.createUser({
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  password: 'use-a-strong-password',
  role: 'user',
});

const signedIn = await auth.authenticateUser('ada@example.com', 'use-a-strong-password');
const session  = await auth.validateSession(sessionToken);
await auth.logout(sessionToken);

// Personal access tokens for scripts and APIs. The raw token is returned once: store it.
const created = await auth.createApiToken('ada@example.com', 'ci-token');
const owner   = await auth.validateApiToken(created.token);
```

### File Operations

```javascript
await filing.create('reports/summary.txt', 'Hello');
const text = await filing.read('reports/summary.txt', 'utf8');
await filing.update('reports/summary.txt', 'Updated');
const entries = await filing.list('reports');
await filing.delete('reports/summary.txt');
```

### AI

```javascript
const answer = await ai.prompt('What is machine learning?');
const summary = await ai.prompt(text, { maxTokens: 500, temperature: 0.7 });
```

`aiservice` is backed by the provider you choose (`claude`, `openai`, `ollama`, `gemini`, `openai-kv`, `tensorflow`). For one client across providers, see the shared module in `src/aiservice/common/` (`nooblyjs-ai-common`).

## Patterns

### Cache-Aside Pattern

```javascript
async function getOrder(id) {
  const cached = await cache.get(`order:${id}`);
  if (cached) return cached;

  const order = await dataStore.getByUuid('orders', id);
  if (order) await cache.put(`order:${id}`, order);
  return order;
}
```

### Error Handling

```javascript
try {
  return await dataStore.getByUuid('orders', id);
} catch (error) {
  logger.error('Order lookup failed', { id, error: error.message });
  throw error;
}
```

Log the full error on the server. Do not send `error.message` to a client for server faults. Use `ClientError` from `src/shared/utils/httpErrors.js` for errors that are safe to show.

### Dependency Injection

```javascript
class OrderService {
  constructor({ dataStore, cache, logger }) {
    this.dataStore = dataStore;
    this.cache = cache;
    this.logger = logger;
  }

  async getOrder(id) {
    const cached = await this.cache.get(`order:${id}`);
    if (cached) return cached;
    const order = await this.dataStore.getByUuid('orders', id);
    if (order) await this.cache.put(`order:${id}`, order);
    return order;
  }
}

const orderService = new OrderService({
  dataStore: serviceRegistry.dataService('file'),
  cache: serviceRegistry.cache('redis'),
  logger: serviceRegistry.logger('file'),
});
```

### Event Listeners

```javascript
const emitter = serviceRegistry.getEventEmitter();

emitter.on('service:created', ({ serviceName, providerType }) => {
  console.log('Service created:', serviceName, providerType);
});

emitter.on('cache:put:default', ({ key }) => {
  console.log('Cached:', key);
});
```

Services emit `{service}:{operation}:{instanceName}` events, for example `cache:get:sessions`. Analytics modules listen on these events.

## Express Integration Examples

### Protected Routes with an API Token

```javascript
const auth = serviceRegistry.authservice('file');

const requireToken = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const user = await auth.validateApiToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid token' });

  req.user = user;
  next();
};

app.get('/profile', requireToken, (req, res) => {
  res.json({ user: req.user });
});
```

### Queue Processing

```javascript
app.post('/process-data', async (req, res) => {
  await queue.enqueue('heavy-task', { data: req.body });
  res.status(202).json({ accepted: true });
});
```

Process `heavy-task` in a worker loop (see Queueing above) or from a Working activity script.

### Data API

```javascript
const dataStore = serviceRegistry.dataService('file');

app.post('/api/:container', async (req, res) => {
  await dataStore.createContainer(req.params.container);
  const uuid = await dataStore.add(req.params.container, req.body);
  res.status(201).json({ uuid });
});

app.get('/api/:container/:uuid', async (req, res) => {
  const item = await dataStore.getByUuid(req.params.container, req.params.uuid);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.put('/api/:container/:uuid', async (req, res) => {
  await dataStore.update(req.params.container, req.params.uuid, req.body);
  res.json({ success: true });
});

app.delete('/api/:container/:uuid', async (req, res) => {
  await dataStore.remove(req.params.container, req.params.uuid);
  res.json({ success: true });
});
```

The REST routes for each service are also mounted under `/services/{service}/api/...`. Those routes are documented in each service's Swagger file.

## Service Providers Reference

The provider names below are the case labels in each service's `index.js`. The first provider listed is the default where the service has one.

| Service | Providers |
|---------|-----------|
| logging | memory, file, api |
| caching | memory, redis, memcached, file, api, aws, azure, gcp |
| dataservice | memory, file, mongodb, documentdb, simpledb, api |
| queueing | memory, redis, rabbitmq, activemq, aws, azure, gcp, api |
| filing | local, ftp, s3, git, gcp, api, sync |
| authservice | memory, file, passport, google, azure, secure-email, api |
| aiservice | claude (default), openai (`chatgpt` alias), openai-kv, ollama, gemini, tensorflow |
| settings | file, encrypted |
| fetching | node (default), axios |
| notifying | default (in-memory), api |
| measuring | default, api |
| working | default, api |
| workflow | memory, api |
| searching | memory (default), vector / semantic, solr, api |
| scheduling | memory |

## Testing

```javascript
const { EventEmitter } = require('events');

describe('Order service', () => {
  let cache, dataStore;

  beforeEach(() => {
    serviceRegistry.reset();
    serviceRegistry.initialize(express(), new EventEmitter(), {});
    cache = serviceRegistry.cache('memory');
    dataStore = serviceRegistry.dataService('memory');
  });

  afterEach(() => serviceRegistry.reset());

  it('caches a record', async () => {
    await dataStore.createContainer('items');
    const uuid = await dataStore.add('items', { name: 'test' });
    await cache.put(`item:${uuid}`, { name: 'test' });

    const cached = await cache.get(`item:${uuid}`);
    expect(cached.name).toBe('test');
  });
});
```

Tests that write to disk should use the shared `testDataDir()` helper and clean up in `afterEach`. See `CONTRIBUTING.md`.

## Key Methods

```javascript
// Service management
serviceRegistry.getService(name, providerType, options);
serviceRegistry.getServiceInstance(name, providerType, instanceName);
serviceRegistry.listServices();
serviceRegistry.listInstances(serviceName);
serviceRegistry.setDefaultProvider(serviceName, providerType, options);
serviceRegistry.resetService(serviceName);
serviceRegistry.reset();

// Utilities
serviceRegistry.generateApiKey(length);
serviceRegistry.validateDependencies();
serviceRegistry.getEventEmitter();
```

## Environment Variables

The full list, with comments, is in `.env.example`. The most common variables:

```bash
PORT=9000
NODE_ENV=production
NOOBLYJS_API_KEYS=key1,key2
SESSION_SECRET=your-session-secret
SETTINGS_SECRET=your-settings-secret        # encrypts the settings service
REDIS_URL=redis://localhost:6379            # shared sessions and Redis-backed providers
FILING_BASE_DIR=./.application/files        # where filing uploads are stored
TRUST_PROXY=1                               # behind a TLS-terminating proxy
CSP_MODE=enforce                            # enforce | report-only | off
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Key Points

- **Singleton**: `ServiceRegistry` is a singleton. Use it everywhere; don't create a second one.
- **Create once, reuse**: Calling `serviceRegistry.cache('redis')` again returns the same instance. The call is cheap, but do it at module load, not in each request.
- **Dependency injection**: Services receive their dependencies through `options.dependencies`, and the registry resolves them for you.
- **Async**: Most service methods return promises. Always `await` them.
- **Named instances**: The same service type can run several named instances, for example separate caches for sessions and data.
- **Events**: Services emit events for lifecycle and operations. Use them for auditing and metrics.
- **Analytics**: Each service exposes its analytics through its provider, for example `cache.getAnalytics()`.

## Common Mistakes to Avoid

```javascript
// ❌ Creating a service on every request
app.get('/api/data', () => {
  const cache = serviceRegistry.cache('redis');
});

// ✅ Create once, reuse
const cache = serviceRegistry.cache('redis');
app.get('/api/data', async (req, res) => {
  res.json(await cache.get('key'));
});

// ❌ Missing await. The result is a promise, not a value.
app.get('/api/data/:id', async (req, res) => {
  const item = dataStore.getByUuid('items', req.params.id);
  res.json(item);
});

// ✅ Await the call
app.get('/api/data/:id', async (req, res) => {
  const item = await dataStore.getByUuid('items', req.params.id);
  res.json(item);
});

// ❌ Hitting the database for every request
app.get('/users', async (req, res) => {
  res.json(await dataStore.listAll('users'));
});

// ✅ Cache expensive reads
app.get('/users', async (req, res) => {
  let users = await cache.get('users:all');
  if (!users) {
    users = await dataStore.listAll('users');
    await cache.put('users:all', users);
  }
  res.json(users);
});
```
