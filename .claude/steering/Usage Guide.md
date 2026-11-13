# NooblyJS Core - Usage Guide

This document gives detailed examples and best practices for integrating NooblyJS Core into an application. Method names match the provider classes in `src/*/providers/`. For the short version, see `Usage Guide Concise.md`.

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Service Registry Initialization](#service-registry-initialization)
3. [Service Usage Examples](#service-usage-examples)
4. [Advanced Patterns](#advanced-patterns)
5. [Real-World Scenarios](#real-world-scenarios)
6. [Error Handling](#error-handling)
7. [Performance Tips](#performance-tips)
8. [Testing with the Library](#testing-with-the-library)

---

## Installation & Setup

### NPM Installation

```bash
npm install nooblyjs-core
```

### Basic Import

```javascript
const serviceRegistry = require('nooblyjs-core');
```

The package exports a singleton `ServiceRegistry` instance that creates and caches every service.

---

## Service Registry Initialization

### Minimal Setup

For development and small applications. There is no API-key or login protection in this setup, so do not expose it to a network.

```javascript
const express = require('express');
const { EventEmitter } = require('events');
const serviceRegistry = require('nooblyjs-core');

const app = express();
const eventEmitter = new EventEmitter();

serviceRegistry.initialize(app, eventEmitter, {});

const logger = serviceRegistry.logger('memory');
logger.info('Application started');

app.listen(3000, () => {
  logger.info('Server running on port 3000');
});
```

### Production Setup

Protect the service endpoints with API keys and require a login for the `/services` dashboards:

```javascript
const express = require('express');
const { EventEmitter } = require('events');
const serviceRegistry = require('nooblyjs-core');

const app = express();
const eventEmitter = new EventEmitter();

serviceRegistry.initialize(app, eventEmitter, {
  security: {
    apiKeyAuth: {
      apiKeys: (process.env.NOOBLYJS_API_KEYS || '').split(',').filter(Boolean),
      requireApiKey: true,
      excludePaths: ['/health'],
    },
    servicesAuth: {
      requireLogin: true,                 // /services/* requires an authenticated admin session
    },
  },
});

// Log service errors that are not tied to a single call
serviceRegistry.getEventEmitter().on('error', (error) => {
  serviceRegistry.logger('file').error('Service error', { error: error.message });
});

app.listen(process.env.PORT || 9000);
```

Set `SESSION_SECRET` and `SETTINGS_SECRET` in the environment. Behind a TLS-terminating proxy, also set `TRUST_PROXY`, otherwise the Secure session cookie is never sent. See `.env.example` for the full list.

---

## Service Usage Examples

### 1. Logging Service

#### Basic Logging

```javascript
const logger = serviceRegistry.logger('file');

logger.debug('Debug message', { requestId: '123' });
logger.info('User logged in', { userId: 'user-456' });
logger.warn('Rate limit approaching', { userId: 'user-456', remaining: 10 });
logger.error('Database connection failed', { error: 'ECONNREFUSED' });
```

Each level takes a message and a metadata object. Keep the metadata structured so the log can be searched.

#### Using the Logger in a Route Handler

```javascript
const logger = serviceRegistry.logger('file');

app.post('/orders', async (req, res) => {
  logger.info('Order received', { customerId: req.body.customerId });
  try {
    // ... create the order ...
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('Order failed', { customerId: req.body.customerId, error: err.message });
    res.status(500).json({ error: 'Order could not be placed' });   // no internal detail to the client
  }
});
```

#### Analytics

```javascript
const stats = logger.analytics.getStats();
```

### 2. Caching Service

#### Basic Caching

```javascript
const cache = serviceRegistry.cache('memory');

await cache.put('user:123', { id: '123', name: 'Ada' });
const user = await cache.get('user:123');        // undefined when the key is missing
await cache.delete('user:123');

const stats = cache.getAnalytics();
```

#### Redis Caching in Production

```javascript
const cache = serviceRegistry.cache('redis', {
  redisurl: process.env.REDIS_URL,
});
```

Choose the provider per environment and keep the calling code the same. The memory provider is for development and single-instance deployments; Redis, Memcached, and the cloud providers (AWS ElastiCache, Azure Cache for Redis, GCP Memorystore) are for shared caches.

#### Cache-Aside Pattern

```javascript
async function getProduct(productId) {
  const key = `product:${productId}`;

  const cached = await cache.get(key);
  if (cached) return cached;

  const product = await dataStore.getByUuid('products', productId);
  if (product) await cache.put(key, product);
  return product;
}

async function updateProduct(productId, changes) {
  await dataStore.update('products', productId, changes);
  await cache.delete(`product:${productId}`);      // invalidate so the next read is fresh
}
```

#### Memcached for Distributed Caching

```javascript
const cache = serviceRegistry.cache('memcached');
```

### 3. Data Service

#### In-Memory Data Store

```javascript
const dataStore = serviceRegistry.dataService('memory');

await dataStore.createContainer('users');

const userId = await dataStore.add('users', { name: 'Ada', role: 'admin' });  // returns the uuid
const user = await dataStore.getByUuid('users', userId);                       // null when not found

await dataStore.update('users', userId, { role: 'editor' });
await dataStore.remove('users', userId);

const everyone = await dataStore.listAll('users');
const matches = await dataStore.find('users', 'Ada');   // search term across the record
const total = await dataStore.count('users');
```

#### MongoDB Integration

```javascript
const dataStore = serviceRegistry.dataService('mongodb', {
  connectionString: process.env.MONGODB_URI,
  database: 'shop',
});
```

The MongoDB provider also accepts `connectionTimeout`, `queryTimeout` and `maxConnections`. DocumentDB uses the same interface, and SimpleDB is available for AWS key-value storage. The MongoDB suites are skipped unless `RUN_MONGODB_TESTS=1` is set and a live database is available.

#### File-Based Persistence

```javascript
const dataStore = serviceRegistry.dataService('file');
```

#### Working with Containers

Each container is a collection of records addressed by uuid:

```javascript
await dataStore.createContainer('products');
await dataStore.createContainer('orders');

const productId = await dataStore.add('products', { sku: 'LAP-1', price: 999 });
const product = await dataStore.getByUuid('products', productId);

const allProducts = await dataStore.listAll('products');
const productCount = await dataStore.count('products');
```

### 4. Queueing Service

#### In-Memory Queuing

```javascript
const queue = serviceRegistry.queue('memory');

await queue.enqueue('send-email', { to: 'ada@example.com', subject: 'Welcome' });

// Queues are read, not subscribed to. Poll them from a worker.
setInterval(async () => {
  const job = await queue.dequeue('send-email');
  if (!job) return;
  await sendEmail(job);
}, 1000);

const waiting = await queue.size('send-email');
```

#### Redis Queue for Distributed Processing

```javascript
const queue = serviceRegistry.queue('redis');
```

Several worker processes can poll the same Redis-backed queue. Each item is dequeued by one worker.

#### Retry Logic

The queue does not retry for you. Put the attempt count in the item and enqueue it again on failure:

```javascript
const MAX_ATTEMPTS = 3;

async function runJob(job) {
  try {
    await downloadFile(job.url);
  } catch (err) {
    if (job.attempts + 1 < MAX_ATTEMPTS) {
      await queue.enqueue('download-file', { ...job, attempts: job.attempts + 1 });
    } else {
      logger.error('Download failed permanently', { url: job.url, error: err.message });
    }
  }
}

setInterval(async () => {
  const job = await queue.dequeue('download-file');
  if (job) await runJob(job);
}, 500);
```

Enqueue the first attempt with `attempts: 0`.

#### Reliable Jobs

On the memory and Redis providers, a job can retry with backoff, dead-letter after its last attempt, and be deduplicated by an idempotency key:

```javascript
const queue = serviceRegistry.queue('redis');

const id = await queue.enqueue('send-email', { to: 'ada@example.com' }, {
  attempts: 5,
  backoff: { type: 'exponential', delayMs: 1000 },
  idempotencyKey: 'welcome-ada',
  dedupeWindowMs: 86400000
});

queue.process('send-email', async (job) => {
  await sendEmail(job.data); // throw to retry; after the last attempt the job is dead-lettered
});

const job = await queue.getJob(id, 'send-email');
const counts = await queue.jobCounts('send-email');
await queue.retryDeadLetters('send-email'); // requeue every dead-lettered job
```

Other queue providers refuse these options with a 400. Use the plain `enqueue` and `dequeue` calls there.

The same operations are available over HTTP, on the default instance and on named instances (`/services/queueing/api/{instanceName}/queues/...`):

- `POST /services/queueing/api/queues/{queueName}/jobs` with `{ data, options }` returns `201 { data: { id } }`
- `GET /services/queueing/api/queues/{queueName}/jobs/{jobId}` returns the job, or `404`
- `POST /services/queueing/api/queues/{queueName}/retry-dead` requeues dead-lettered jobs
- `GET /services/queueing/api/queues/{queueName}/job-counts` returns counts by state

The queueing dashboard has a Reliable jobs tab that shows the same counts and retries dead letters.

The `working` service uses this on the memory and Redis providers. Each task is enqueued with one attempt. Its failures are recorded by the working service itself, so a failed script is not run again. A task is acknowledged when its worker finishes. If the process dies first, another process redelivers it after the lease runs out, so a script can run twice in that case. Keep scripts safe to repeat.

### 5. Workflow Service

A workflow is a named list of step scripts. The steps run in order. Each step receives the original input and the outputs of the steps before it. Relative step paths resolve against the working service's activities folder.

#### Simple Workflow

```javascript
const workflow = serviceRegistry.workflow('memory');

await workflow.defineWorkflow('order-processing', [
  'validate-order.js',
  'charge-payment.js',
  'send-confirmation.js',
]);

await workflow.runWorkflow(
  'order-processing',
  { orderId: 'ord-1001', amount: 49.99 },
  (status) => logger.info('Order workflow status', { status }),
);
```

#### Several Workflows

Define each process as its own workflow. Branching belongs in the step scripts, or in the application code that decides which workflow to start:

```javascript
await workflow.defineWorkflow('refund', ['check-eligibility.js', 'refund-payment.js']);
await workflow.defineWorkflow('dispute', ['open-case.js', 'notify-support.js']);

const kind = order.status === 'returned' ? 'refund' : 'dispute';
await workflow.runWorkflow(kind, { orderId: order.id });
```

### 6. Scheduling Service

Scheduled tasks run a script on a cron expression. Use the same scheduler instance for the life of the process.

```javascript
const scheduler = serviceRegistry.scheduling('memory');

// Every day at 02:00
await scheduler.startCron({ scriptPath: 'nightly-cleanup.js' }, '0 2 * * *', 'nightly-cleanup');

// Every five minutes
await scheduler.startCron({ scriptPath: 'send-pending-emails.js' }, '*/5 * * * *', 'send-pending');

// Control a task
await scheduler.pause('send-pending');
await scheduler.resume('send-pending');
await scheduler.runNow('nightly-cleanup');

const tasks = await scheduler.listSchedules();
const stats = await scheduler.getStats();
```

Cron expressions are five fields: minute, hour, day of month, month and day of week.

### 7. Search Service

```javascript
const search = serviceRegistry.searching('memory');

await search.add('article-1', {
  title: 'Getting started',
  content: 'Install the package and create a registry.',
});

const results = await search.search('getting started');   // array of matching documents
```

`add` resolves to `false` when the key already exists. Use `replace` to overwrite a document, `remove` to delete one and `addAll` to index a batch. For remote or semantic search, pick the matching provider (`api`, `solr`, `vector` or `semantic`) and see its provider file for its options.

Index only the fields you search on. Indexing every field of a large document uses memory with no gain in results.

### 8. File Operations Service

#### Local File Operations

```javascript
const filing = serviceRegistry.filing('local');

await filing.create('documents/report.txt', 'Quarterly report');
const content = await filing.read('documents/report.txt', 'utf8');
await filing.update('documents/report.txt', 'Revised report');

const entries = await filing.list('documents');
await filing.delete('documents/report.txt');
```

Filing stores files under `FILING_BASE_DIR` (default `./.application/files`), never in the application root. Paths are checked, so a path cannot leave that folder.

#### S3 Cloud Storage

```javascript
const filing = serviceRegistry.filing('s3', {
  bucketName: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
});

await filing.create('user-uploads/profile.jpg', imageBuffer);
const image = await filing.read('user-uploads/profile.jpg');
```

The provider also accepts `accessKeyId` and `secretAccessKey` options. Keep the secret out of source code and load it from the environment.

#### Git-Based File Storage

The `git` provider keeps the file store in a Git repository. The filing service also exposes the Git operations over REST, under `/services/filing/api/git/`: `status`, `commit`, `push`, `fetch`, `pending`, and `auto-fetch/start` and `auto-fetch/stop`. Configure the repository and credentials through the provider options; see `src/filing/providers/filingGit.js`.

### 9. Authentication Service

#### File-Based Authentication

```javascript
const auth = serviceRegistry.authservice('file');

await auth.createUser({
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  password: 'a-strong-passphrase',
  role: 'user',
});

const user = await auth.authenticateUser('ada@example.com', 'a-strong-passphrase');
const session = await auth.validateSession(sessionToken);
await auth.logout(sessionToken);

await auth.changePassword('ada@example.com', 'old-passphrase', 'new-passphrase');
```

#### API Tokens

Personal access tokens let scripts and other services call the API as a user. The raw token is shown once, so store it when it is created:

```javascript
const created = await auth.createApiToken('ada@example.com', 'ci-pipeline', { expiresInDays: 30 });
// created.token is the raw value to hand to the caller

const owner = await auth.validateApiToken(presentedToken);
```

Check `src/authservice/providers/authBase.js` for the options `createApiToken` accepts.

#### Roles, Permissions and Token Scopes

Every `/services/*/api` route declares the permission it needs (`src/authservice/config/routePermissions.js`). Roles grant permissions (`src/authservice/modules/permissions.js`): `admin` has everything, `editor` can use filing, searching, dataservice, caching and queueing, and `user` can read filing and searching and manage its own profile.

A personal access token can carry fewer permissions than its owner, but never more. The owner's role is checked when the token is created, so a `user` asking for `filing:write` is refused:

```javascript
const narrow = await auth.createApiToken('ada@example.com', 'read-only-ci', {
  scopes: ['filing:read', 'searching:read']
});
```

In production, strictAuth is on: an undeclared route is refused and start-up fails.

#### Using Auth in Express Routes

```javascript
const auth = serviceRegistry.authservice('file');

async function requireUser(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Sign in required' });

  let user;
  try {
    user = await auth.validateApiToken(token); // throws when the token is invalid or expired
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
}

app.get('/profile', requireUser, (req, res) => {
  res.json({ user: req.user });
});
```

#### Invitations

An invitation is a one-time code that lets someone create a password and become an active user:

```javascript
const invite = await auth.requestInvitation({
  name: 'Grace Hopper',
  email: 'grace@example.com',
  mobile: '+27820000000',          // optional
});

// The current implementation issues codes that are usable immediately (auto-approved).
// approveInvitation(code) is available for flows where an admin approves first.
await auth.redeemInvitation(invite.code, 'a-strong-passphrase');   // a code can be redeemed once
```

#### Google Sign-In

Google sign-in uses the `google` provider and the `/services/authservice/api/google` routes. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Use `redirect.js` (`safeReturnUrl`, `postLoginRedirect`) to send the user back to the page they came from. Only same-origin paths are accepted.

### 10. AI Service

#### Using Claude

```javascript
const ai = serviceRegistry.aiservice('claude');   // uses ANTHROPIC_API_KEY from the environment

const answer = await ai.prompt('What is the capital of France?');

const analysis = await ai.prompt(`Summarise this review:\n\n${review}`, {
  maxTokens: 300,
  temperature: 0.2,
});
```

#### Using OpenAI

```javascript
const ai = serviceRegistry.aiservice('openai');   // reads OPENAI_API_KEY
const reply = await ai.prompt('Write a product description for a laptop', { maxTokens: 200 });
```

Other providers are `ollama` (local models), `gemini`, `openai-kv` (Azure OpenAI through Key Vault) and `tensorflow` (optional). For one client that works across Anthropic, OpenAI, Bedrock, Vertex AI and Azure, use the shared module in `src/aiservice/common/`.

---

## Advanced Patterns

### Multi-Instance Services

Named instances give one service type separate state and analytics:

```javascript
const sessionCache = serviceRegistry.cache('redis', { instanceName: 'sessions' });
const productCache = serviceRegistry.cache('redis', { instanceName: 'products' });

await sessionCache.put('user:123:session', sessionData);
await productCache.put('products:all', products);
```

Events carry the instance name, so `cache:put:sessions` and `cache:put:products` can be listened to separately.

### Dependency Injection Pattern

Pass the services into your classes instead of calling the registry inside each method. This keeps the classes easy to test:

```javascript
class UserRepository {
  constructor({ dataStore, cache, logger }) {
    this.dataStore = dataStore;
    this.cache = cache;
    this.logger = logger;
  }

  async getUser(userId) {
    const key = `user:${userId}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const user = await this.dataStore.getByUuid('users', userId);
    if (user) await this.cache.put(key, user);
    return user;
  }

  async createUser(userData) {
    const userId = await this.dataStore.add('users', userData);
    this.logger.info('User created', { userId });
    return userId;
  }
}

const userRepository = new UserRepository({
  dataStore: serviceRegistry.dataService('file'),
  cache: serviceRegistry.cache('memory'),
  logger: serviceRegistry.logger('file'),
});
```

### Error Handling with Event Emitters

Services report operational failures on the shared event emitter. Listen for them in one place:

```javascript
const emitter = serviceRegistry.getEventEmitter();

emitter.on('service:creation-error', ({ serviceName, providerType, error }) => {
  logger.error('Service failed to start', { serviceName, providerType, error });
});
```

### Transaction Pattern with Rollback

The data service has no multi-record transactions. Keep the compensating steps in code:

```javascript
async function transfer(fromUserId, toUserId, amount) {
  const from = await dataStore.getByUuid('accounts', fromUserId);
  const to = await dataStore.getByUuid('accounts', toUserId);

  await dataStore.update('accounts', fromUserId, { balance: from.balance - amount });
  try {
    await dataStore.update('accounts', toUserId, { balance: to.balance + amount });
  } catch (err) {
    // Roll back the debit if the credit fails
    await dataStore.update('accounts', fromUserId, { balance: from.balance });
    throw err;
  }

  await cache.delete(`account:${fromUserId}`);
  await cache.delete(`account:${toUserId}`);
}
```

---

## Real-World Scenarios

### E-Commerce Application

```javascript
const cache = serviceRegistry.cache('redis');
const dataStore = serviceRegistry.dataService('mongodb', {
  connectionString: process.env.MONGODB_URI,
  database: 'shop',
});
const queue = serviceRegistry.queue('redis');
const logger = serviceRegistry.logger('file');

// Product catalogue, cached until it is invalidated
app.get('/products', async (req, res) => {
  let products = await cache.get('products:all');
  if (!products) {
    products = await dataStore.listAll('products');
    await cache.put('products:all', products);
  }
  res.json(products);
});

// Create the order, then hand fulfilment to a worker
app.post('/orders', async (req, res) => {
  const orderId = await dataStore.add('orders', { ...req.body, status: 'pending' });
  await queue.enqueue('process-order', { orderId });
  res.status(202).json({ orderId });
});

// Worker loop
setInterval(async () => {
  const job = await queue.dequeue('process-order');
  if (!job) return;

  const order = await dataStore.getByUuid('orders', job.orderId);
  // charge payment, reserve stock, send email ...
  await dataStore.update('orders', job.orderId, { status: 'processed' });
  logger.info('Order processed', { orderId: job.orderId });
}, 500);
```

### Content Management System

```javascript
const filing = serviceRegistry.filing('local');
const search = serviceRegistry.searching('memory');
const dataStore = serviceRegistry.dataService('file');

app.post('/articles', async (req, res) => {
  const articleId = await dataStore.add('articles', {
    title: req.body.title,
    body: req.body.body,
    status: 'draft',
  });

  await search.add(articleId, { title: req.body.title, body: req.body.body });
  res.status(201).json({ articleId });
});

app.post('/articles/:id/image', async (req, res) => {
  const path = `articles/${req.params.id}/image.jpg`;
  await filing.create(path, req.files.image.data);
  await dataStore.update('articles', req.params.id, { imagePath: path });
  res.json({ path });
});

app.get('/search', async (req, res) => {
  res.json(await search.search(req.query.q));
});
```

### Real-Time Analytics Platform

```javascript
const scheduler = serviceRegistry.scheduling('memory');
const dataStore = serviceRegistry.dataService('file');
const logger = serviceRegistry.logger('file');

// Roll up raw events every minute
await scheduler.startCron({ scriptPath: 'rollup-events.js' }, '* * * * *', 'event-rollup');

app.post('/events', async (req, res) => {
  await dataStore.add('events', { ...req.body, receivedAt: new Date().toISOString() });
  res.status(202).end();
});

app.get('/events/summary', async (req, res) => {
  const events = await dataStore.listAll('events');
  res.json({ total: events.length });
});
```

---

## Error Handling

### Basic Error Handling

```javascript
async function getOrder(orderId) {
  try {
    const order = await dataStore.getByUuid('orders', orderId);
    if (!order) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }
    return order;
  } catch (err) {
    logger.error('Failed to read order', { orderId, error: err.message });
    throw err;
  }
}
```

Use `ClientError` from `src/shared/utils/httpErrors.js` for errors that are safe to show to a client, and `sendSafeError` for every other error, so a server fault never returns its message.

### Fallback Pattern

```javascript
async function getRecommendations(userId) {
  try {
    return await recommendationsApi.fetch(userId);
  } catch (err) {
    logger.warn('Recommendations unavailable, using defaults', { error: err.message });
    return await cache.get('recommendations:default');
  }
}
```

### Circuit Breaker Pattern

A circuit breaker stops calls to a failing dependency for a while. The breaker is application code that wraps the service call:

```javascript
class CircuitBreaker {
  constructor(fn, { threshold = 5, resetMs = 30000 } = {}) {
    this.fn = fn;
    this.threshold = threshold;
    this.resetMs = resetMs;
    this.failures = 0;
    this.openedAt = null;
  }

  async call(...args) {
    if (this.openedAt && Date.now() - this.openedAt < this.resetMs) {
      throw new Error('Circuit open');
    }
    try {
      const result = await this.fn(...args);
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.threshold) this.openedAt = Date.now();
      throw err;
    }
  }
}

const readItems = new CircuitBreaker((query) => dataStore.find('items', query));
```

---

## Performance Tips

### 1. Cache Strategy

Cache reads that are expensive and change rarely. Invalidate on write:

```javascript
async function getSettings() {
  let settings = await cache.get('settings');
  if (!settings) {
    settings = await dataStore.listAll('settings');
    await cache.put('settings', settings);
  }
  return settings;
}
```

### 2. Batch Operations

Run independent writes together with `Promise.all`, not one at a time in a loop when order does not matter:

```javascript
await Promise.all(records.map((record) => dataStore.add('imports', record)));
```

Keep the batch size bounded so one request cannot exhaust memory or the database pool.

### 3. Queue Heavy Operations

Move slow work (image processing, report generation, large imports) onto a queue or into a Working activity, and answer the request straight away.

### 4. Connection Pooling

Share one service instance across the process. For the MongoDB provider, tune `maxConnections`, `connectionTimeout` and `queryTimeout`.

### 5. Index Important Fields

Index only the fields you search on, and rebuild the index when the document shape changes.

---

## Testing with the Library

### Test Kit (`nooblyjs-core/testing`)

```javascript
const { createTestRegistry, installMatchers } = require('nooblyjs-core/testing');
installMatchers();

let t;
beforeEach(async () => { t = await createTestRegistry({ services: ['caching'] }); });
afterEach(() => t.cleanup());           // resets the registry and removes its temp directory

it('caches orders', async () => {
  await t.registry.cache('memory').put('order', { total: 9 });
  expect(t.events).toHaveEmitted('cache:put:default', { key: 'order' });
  await t.request('get', '/services/caching/api/settings').expect(200); // sends the test API key
});
```

Services: logging, caching, queueing, dataservice, scheduling, searching, measuring, working, workflow, notifying, fetching. Memory providers only; the kit writes under `.temp/tests/data/`.

### Provider contracts

`tests/contract/` holds one suite per service that every provider must pass. `npm test` runs the memory provider. Against a real Redis:

```bash
docker run -d -p 6379:6379 redis:7-alpine
RUN_REDIS_TESTS=1 REDIS_URL=redis://127.0.0.1:6379 npm run test:contract
```

## Knowledge Service (ask your docs)

```javascript
const kb = serviceRegistry.knowledge('default', {
  dependencies: { aiservice: serviceRegistry.aiservice('claude', { apiKey: process.env.ANTHROPIC_API_KEY }) }
});
await kb.sync({ directory: 'docs' });                  // new and changed Markdown and text files only
const answer = await kb.ask('How do I rotate the settings secret?');
// { text, confidence: 'cited' | 'low' | 'none', citations: [{ n, path, title, heading, snippet, score }] }
```

The knowledge service creates its own vector search instance (`instanceName: 'knowledge'`, hash embeddings by default). Pass `embedding: { backend: 'aiservice', aiservice }` through the searching dependency for real embeddings. Sync state lives in memory, so the first sync after a restart indexes everything again. Access control by role is not applied yet, so any indexed document can be cited.

REST: `POST /services/knowledge/api/sync`, `/retrieve` and `/ask` (body `{ question, k }`), and `GET /services/knowledge/api/status`. The editor role has these; a plain user does not.

Semantic search over any index with a vector provider: `GET /services/searching/api/semantic?query=...&index=...&mode=hybrid|semantic`.

## Model Context Protocol (MCP)

Enable the endpoint and let coding agents inspect the running app:

```javascript
serviceRegistry.initialize(app, eventEmitter, {
  apiKeys: ['...'],
  mcp: { enabled: true, allowWrite: false }   // allowWrite adds the write tools (admin only)
});
```

`POST /services/mcp` takes JSON-RPC 2.0 messages. Authenticate with an API key or a personal access token. Each tool checks the permission its REST route needs, so a user without `queueing:read` cannot read queue stats through MCP.

From Claude Code, use the stdio bridge:

```bash
claude mcp add nooblyjs -- npx nooblyjs mcp --url http://localhost:9000
# set NOOBLYJS_TOKEN (a personal access token) or NOOBLYJS_API_KEY in the environment
```

Read tools: `logs.recent`, `queue.stats`, `data.count`, `data.find`, `search.query`, `workflow.listRuns`, `workflow.getRun`, `scheduling.listSchedules`, `monitoring.snapshot`. Resources: `nooblyjs://services`, `nooblyjs://openapi`. Prompts: `diagnose-failed-run`, `explain-service-config`.

## Command-Line Tool (`nooblyjs`)

```bash
npx nooblyjs create my-app --yes      # minimal API app with a test
npx nooblyjs doctor                   # environment checks; exits 1 on failure (use in CI)
npx nooblyjs routes --url http://localhost:9000
npx nooblyjs openapi --url http://localhost:9000 --out openapi.json
npx nooblyjs openapi --url http://localhost:9000 --client ts --out src/api-client.ts
npx nooblyjs keys generate --length 48
```

`routes` and `openapi` read `NOOBLYJS_API_KEY` or `NOOBLYJS_TOKEN` from the environment. The merged document is also served at `/services/api/openapi.json`.

### Unit Testing Services

Create a fresh registry state in each test and clean up afterwards:

```javascript
const { EventEmitter } = require('events');
const express = require('express');
const serviceRegistry = require('nooblyjs-core');

describe('UserRepository', () => {
  let cache;
  let dataStore;
  let repository;

  beforeEach(() => {
    serviceRegistry.reset();
    serviceRegistry.initialize(express(), new EventEmitter(), {});

    cache = serviceRegistry.cache('memory');
    dataStore = serviceRegistry.dataService('memory');
    repository = new UserRepository({
      dataStore,
      cache,
      logger: serviceRegistry.logger('memory'),
    });
  });

  afterEach(() => serviceRegistry.reset());

  it('returns a cached user without reading the data store', async () => {
    await dataStore.createContainer('users');
    const userId = await dataStore.add('users', { name: 'Ada' });
    await cache.put(`user:${userId}`, { name: 'Ada (cached)' });

    const user = await repository.getUser(userId);
    expect(user.name).toBe('Ada (cached)');
  });
});
```

Tests that write to disk should use the shared `testDataDir()` helper (`tests/helpers/testData.js`) and remove their directories afterwards. See `CONTRIBUTING.md`.

### Integration Testing

Start the app against the real providers you run in production (Redis, MongoDB) in a separate test environment, and use HTTP calls to exercise the `/services/{service}/api` routes:

```javascript
const request = require('supertest');

it('stores and returns a record over HTTP', async () => {
  const res = await request(app)
    .post('/services/dataservice/api/products')
    .set('x-api-key', process.env.TEST_API_KEY)
    .send({ sku: 'LAP-1' });

  expect(res.status).toBeLessThan(300);
});
```

---

## Summary

- Initialise the registry once, with the `security` settings for your environment.
- Get each service once and reuse it. Use named instances when one service needs separate state.
- Use the provider names listed in `Usage Guide Concise.md` and the service `index.js` files. The memory provider is for development and tests.
- Await every service call, and keep server-side error detail out of client responses.
- Move slow work to queues and workflows, and keep the request path short.
