# NooblyJS Core

A powerful set of modular Node.js backend services built with the singleton pattern. This framework provides a comprehensive suite of enterprise-grade services for caching, logging, data persistence, file operations, workflow orchestration, AI integration, and more.

## Features

- **Modular Architecture**: 14+ independent services with clear separation of concerns
- **Dependency Injection**: Built-in service dependency resolution and injection
- **Multiple Providers**: Most services support multiple backends (e.g., Redis/Memcached for caching, MongoDB/File for data)
- **Event-Driven**: Global event emitter for inter-service communication
- **Authentication**: API key and OAuth support (Google, Passport)
- **Workflow Orchestration**: Build complex workflows with step execution and queuing
- **AI Integration**: Built-in support for Claude, OpenAI, and Ollama
- **Monitoring & Analytics**: Built-in metrics collection and service dashboards
- **REST API**: Automatic route generation and service discovery
- **Scalable**: Support for multi-instance services and cloud providers (AWS, Azure, GCP)

## Services Overview

NooblyJS Core organizes services into 4 distinct classifications based on their usage patterns and dependencies:

### 🔧 Infrastructure Services (Foundation)
Core foundational services that power all other services. These services have no dependencies on other services and are the building blocks for the framework.

| Service | Purpose | Providers |
|---------|---------|-----------|
| **Logging** | Centralized logging system | Memory, File, API |
| **Caching** | In-memory and distributed caching | Memory, Redis, Memcached, File, API |
| **Queueing** | Message queuing and job processing | Memory, Redis, RabbitMQ, AWS SQS, Azure Queue, GCP Pub/Sub, API |
| **Fetching** | HTTP requests with caching | Node.js native, Axios |
| **Notifying** | Notification delivery system | Memory, API |

### 💼 Business Services
Services that provide extended business logic and data operations. These services build on infrastructure services to provide data management and processing capabilities.

| Service | Purpose | Providers |
|---------|---------|-----------|
| **Data Service** | Data persistence and CRUD operations | Memory, File, MongoDB, DocumentDB, SimpleDB |
| **Working** | Worker/activity execution engine | Memory-based task execution |
| **Measuring** | Metrics collection and aggregation | Memory-based metrics storage |

### ⚙️ Application Services
Services that form user-facing application interfaces. These services leverage both infrastructure and business services to provide application-level functionality.

| Service | Purpose | Providers |
|---------|---------|-----------|
| **Scheduling** | Task scheduling and cron jobs | Memory-based scheduler |
| **Searching** | Full-text and indexed search | Memory-based with caching |
| **Workflow** | Workflow and pipeline orchestration | Memory-based with step execution |
| **Filing** | File operations and storage | Local filesystem, FTP, S3, Git, Sync |

### ⭐ Advanced Application Services
Sophisticated services that leverage most underlying services and are almost fully stand-alone applications.

| Service | Purpose | Providers |
|---------|---------|-----------|
| **Auth Service** | User authentication and authorization | File, Memory, Passport, Google OAuth |
| **AI Service** | AI model integration and prompting | Claude (Anthropic), OpenAI, Ollama |

## Quick Start

### Prerequisites
- Node.js >= 12.11.0
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/nooblyjs/nooblyjs-core.git
cd nooblyjs-core

# Install dependencies
npm install
```

### Basic Usage

```javascript
const serviceRegistry = require('./index');
const express = require('express');
const { EventEmitter } = require('events');

// Create Express app
const app = express();

// Initialize service registry
const eventEmitter = new EventEmitter();
const options = {
  logDir: './logs',
  dataDir: './data',
  apiKeys: ['your-api-key-here']
};

serviceRegistry.initialize(app, eventEmitter, options);

// Get service instances
const logger = serviceRegistry.logger('file');
const cache = serviceRegistry.cache('memory');
const dataService = serviceRegistry.dataService('file');

// Use services
logger.info('Application started');
await cache.set('user:1', { name: 'John Doe' });

// Start server
app.listen(3001, () => {
  logger.info('Server running on port 3001');
});
```

### Running the Application

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The application will be available at `http://localhost:3001` (or specified PORT).

## Configuration

### Environment Variables

```bash
# Server port (default: 9000)
PORT=3001

# API Keys (comma-separated)
API_KEYS=key1,key2,key3

# Or use legacy variable name
NOOBLYJS_API_KEYS=key1,key2,key3

# Session secret for authentication
SESSION_SECRET=your-secret-key

# Node environment. In production, strictAuth is on by default: every
# /services/*/api route must declare a permission, or start-up fails.
NODE_ENV=development
```

### Service Options

```javascript
const options = {
  // Logging configuration
  logDir: './logs',

  // Data directory
  dataDir: './data',

  // API key authentication
  apiKeys: ['api-key-1', 'api-key-2'],
  requireApiKey: true,

  // Exclude paths from API key requirement
  excludePaths: [
    '/services/*/status',
    '/services/authservice/api/login',
    '/services/authservice/api/register'
  ],

  // Security configuration
  security: {
    apiKeyAuth: {
      apiKeys: ['key1', 'key2'],
      requireApiKey: true,
      excludePaths: ['/public', '/health']
    },
    servicesAuth: {
      requireLogin: true
    }
  }
};

serviceRegistry.initialize(app, eventEmitter, options);
```

## API Reference

### Service Registry Methods

#### Getting Services

```javascript
// Get logger
const logger = serviceRegistry.logger(providerType, options);

// Get cache
const cache = serviceRegistry.cache(providerType, options);

// Get data service
const dataService = serviceRegistry.dataService(providerType, options);

// Get workflow service
const workflow = serviceRegistry.workflow(providerType, options);

// Get generic service
const service = serviceRegistry.getService(serviceName, providerType, options);
```

#### Named Instances

```javascript
// Create multiple instances of the same service
const sessionCache = serviceRegistry.cache('redis', {
  instanceName: 'session-cache'
});

const dataCache = serviceRegistry.cache('redis', {
  instanceName: 'data-cache'
});

// Retrieve existing instance
const existing = serviceRegistry.getServiceInstance('caching', 'redis', 'session-cache');
```

#### Service Management

```javascript
// List all initialized services
const services = serviceRegistry.listServices();

// List all instances of a service
const instances = serviceRegistry.listInstances('caching');

// Reset all services
serviceRegistry.reset();

// Reset specific service
serviceRegistry.resetService('caching');

// Reset specific instance
serviceRegistry.resetServiceInstance('caching', 'redis', 'session-cache');

// Generate API key
const apiKey = serviceRegistry.generateApiKey(32);

// Validate dependencies
serviceRegistry.validateDependencies();
```

### Logging Service

```javascript
const logger = serviceRegistry.logger('file', { logDir: './logs' });

// Log at different levels
logger.debug('Debug message', { metadata: 'value' });
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message', { error: err });

// Get analytics
const stats = logger.analytics.getAnalytics();
console.log(`Total logs: ${stats.totalLogs}, Errors: ${stats.errorCount}`);
```

### Caching Service

```javascript
const cache = serviceRegistry.cache('memory');

// Set a value
await cache.set('user:123', { name: 'John Doe' });

// Get a value
const user = await cache.get('user:123');

// Delete a value
await cache.delete('user:123');

// Check if key exists
const exists = await cache.has('user:123');

// Clear all cache
await cache.clear();

// Get cache statistics
const stats = cache.analytics.getAnalytics();
console.log(`Hit rate: ${stats.hitRate}%`);
```

### Data Service

```javascript
const dataService = serviceRegistry.dataService('mongodb', {
  connectionString: 'mongodb://localhost:27017',
  database: 'myapp'
});

// Create
await dataService.create('users', { name: 'John', email: 'john@example.com' });

// Read
const user = await dataService.read('users', 'user-id');

// Update
await dataService.update('users', 'user-id', { name: 'Jane' });

// Delete
await dataService.delete('users', 'user-id');

// List
const users = await dataService.list('users');

// Query
const results = await dataService.query('users', { name: 'John' });
```

### Workflow Service

```javascript
const workflow = serviceRegistry.workflow('memory');

// Define a workflow
const workflowDef = {
  name: 'user-onboarding',
  steps: [
    { id: 'validate', type: 'step', handler: './steps/validate.js' },
    { id: 'process', type: 'step', handler: './steps/process.js' },
    { id: 'notify', type: 'step', handler: './steps/notify.js' }
  ]
};

// Execute workflow
const result = await workflow.execute(workflowDef, { userId: '123' });
```

#### Web UI for Workflow Management

The Workflow Service includes a comprehensive **UI dashboard** for managing workflows without code:

- **Workflow Browser**: Browse and search all defined workflows
- **Workflow Editor**: View workflow definitions, edit steps, and see execution details
- **Execution Monitor**: Track workflow executions with status filtering (Completed, Running, Error)
- **Real-time Analytics**: View execution history and performance metrics
- **Workflow Creator**: Create new workflows with an interactive form builder

Access the UI at: `http://localhost:3001/services/workflow` → **UI Tab**

See [Workflow Service Documentation](./docs/usage/workflow-service-usage.md#web-ui-interface) for detailed usage guide.

### AI Service

```javascript
const ai = serviceRegistry.aiservice('claude', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022'
});

// Send prompt
const response = await ai.prompt('What is the capital of France?');

// Use with context
const result = await ai.prompt('Summarize this text: ' + text, {
  maxTokens: 500
});

// Embeddings (shared AI module). Anthropic has no embeddings endpoint, so name one that does.
const embedder = serviceRegistry.aiservice('anthropic', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  embeddings: { provider: 'openai', model: 'text-embedding-3-small', apiKey: process.env.OPENAI_API_KEY }
});
const { vectors } = await embedder.embed(['first text', 'second text']);
```

### Auth Service

```javascript
const auth = serviceRegistry.authservice('file', {
  dataDir: './data/users'
});

// Create a user (role: 'admin', 'editor', 'user' or 'guest')
await auth.createUser({
  email: 'john@example.com',
  fullName: 'John',
  password: 'a-strong-passphrase',
  role: 'user'
});

// Authenticate with email and password
const user = await auth.authenticateUser('john@example.com', 'a-strong-passphrase');

// Personal access token, limited to two permissions (it cannot exceed its owner's)
const created = await auth.createApiToken('john@example.com', 'ci', {
  scopes: ['caching:read', 'filing:read']
});
const owner = await auth.validateApiToken(created.token); // throws when invalid or expired
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/caching/cache.test.js

# Run tests in watch mode
npm test -- --watch

# Run with coverage
npm test -- --coverage
```

### Writing Tests

```javascript
const createService = require('../../../src/caching');
const EventEmitter = require('events');

describe('Cache Service', () => {
  let cache;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');
    cache = createService('memory', {}, mockEventEmitter);
  });

  it('should put and get values', async () => {
    await cache.put('test-key', 'test-value');
    const value = await cache.get('test-key');
    expect(value).toBe('test-value');
    // The cache provider emits instance-namespaced events, e.g. `cache:put:default`.
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('cache:put:default', expect.any(Object));
  });
});
```

### Load Testing

Load tests live under `tests/load/`. There is no dedicated npm script; run them directly with Node (or your load-testing tool of choice) as described in `tests/load/README.md`.

See `tests/load/README.md` for detailed load testing information.

## REST API

Each service exposes REST endpoints at `/services/{serviceName}/api/`:

### Logging Service
- `GET /services/logging/api/logs` - Get logs
- `POST /services/logging/api/logs` - Create log entry
- `GET /services/logging/api/analytics` - Get log analytics

### Caching Service
- `GET /services/caching/api/get/:key` - Get cached value
- `POST /services/caching/api/set` - Set cached value
- `DELETE /services/caching/api/delete/:key` - Delete cached value
- `GET /services/caching/api/analytics` - Get cache analytics

### Data Service
- `GET /services/dataservice/api/:collection` - List items
- `POST /services/dataservice/api/:collection` - Create item
- `GET /services/dataservice/api/:collection/:id` - Get item
- `PUT /services/dataservice/api/:collection/:id` - Update item
- `DELETE /services/dataservice/api/:collection/:id` - Delete item

### Monitoring
- `GET /services/api/monitoring/metrics` - System metrics
- `GET /services/api/monitoring/snapshot` - Current snapshot

## Service Dashboards

Each service provides a web dashboard at `/services/{serviceName}/`:

- `/services/logging/` - Logging dashboard
- `/services/caching/` - Caching dashboard
- `/services/dataservice/` - Data service dashboard
- `/services/workflow/` - Workflow dashboard
- `/services/queueing/` - Queue dashboard
- And more...

Access requires authentication unless configured otherwise.

## Event Emitter

Services communicate through a global event emitter:

```javascript
const eventEmitter = serviceRegistry.getEventEmitter();

// Listen for service creation
eventEmitter.on('service:created', (data) => {
  console.log(`Service created: ${data.serviceName}:${data.providerType}`);
});

// Listen for cache operations. Cache events are namespaced by instance name,
// e.g. `cache:put:default` / `cache:get:default` / `cache:delete:default`.
eventEmitter.on('cache:put:default', (data) => {
  console.log(`Cache put: ${data.key}`);
});

// Listen for log events
eventEmitter.on('log:info', (data) => {
  console.log('Info logged:', data.message);
});

// Listen for authentication events
eventEmitter.on('auth:login', (data) => {
  console.log(`User logged in: ${data.username}`);
});
```

## Dependency Graph

Services have a dependency hierarchy that's automatically resolved:

```
logging (foundation)
├── caching
├── queueing
├── notifying
├── appservice
├── fetching
│   ├── dataservice
│   ├── working
│   └── measuring
│       ├── scheduling
│       ├── searching
│       ├── workflow
│       └── filing
│           ├── authservice
│           └── aiservice
```

The ServiceRegistry ensures dependencies are initialized in order and injects them automatically.

## Performance Considerations

### Caching Strategy
- Use Redis/Memcached for distributed caching in production
- Configure appropriate TTLs (time-to-live) for cache entries
- Monitor cache hit rates via analytics

### Database Optimization
- Use MongoDB/DocumentDB for document-heavy workloads
- Index frequently queried fields
- Use SimpleDB for lightweight data needs

### Queue Configuration
- Use Redis or RabbitMQ for reliable message delivery
- For retries and dead letters, enqueue with options (`queue.enqueue(name, data, { attempts, backoff, idempotencyKey })`) on the memory or Redis provider; other providers refuse these options with a 400
- Monitor queue depth and processing times

### Workflow Optimization
- Break large workflows into smaller steps
- Use caching for frequently accessed data
- Implement retry logic for transient failures

## Troubleshooting

### Service Initialization Fails
```javascript
// Check dependency validation
try {
  serviceRegistry.validateDependencies();
} catch (error) {
  console.error('Dependency validation failed:', error.message);
}
```

### Cache Not Working
```javascript
// Verify cache is initialized
const cache = serviceRegistry.cache('memory');
console.log('Cache initialized:', cache !== null);

// Check analytics
const stats = cache.analytics.getAnalytics();
console.log('Cache stats:', stats);
```

### Database Connection Issues
```javascript
// Test connection with data service
const dataService = serviceRegistry.dataService('mongodb', {
  connectionString: 'mongodb://localhost:27017',
  database: 'test'
});

try {
  await dataService.list('test');
} catch (error) {
  console.error('Connection failed:', error.message);
}
```

## Development

### Project Structure

```
.
├── src/                      # Service implementations
│   ├── logging/             # Logging service
│   ├── caching/             # Caching service
│   ├── dataservice/         # Data service
│   ├── workflow/            # Workflow service
│   ├── filing/              # Filing service
│   ├── authservice/         # Auth service
│   ├── aiservice/           # AI service
│   ├── appservice/          # App base service
│   └── [other services]/
├── tests/
│   ├── unit/                # Unit tests
│   ├── api/                 # API integration tests
│   └── load/                # Load tests
├── public/                  # Static assets
├── index.js                 # ServiceRegistry singleton
├── app.js                   # Example application
└── package.json
```

### Adding a New Service

1. Create service directory: `src/newservice/`
2. Create factory: `src/newservice/index.js`
3. Create providers: `src/newservice/providers/`
4. Create routes: `src/newservice/routes/index.js`
5. Create views: `src/newservice/views/`
6. Register in ServiceRegistry: `index.js` dependencies
7. Add tests: `tests/unit/newservice/`
8. Update documentation

### Code Style

The project uses JavaScript ES6+ with no TypeScript. Follow these conventions:

- Use descriptive variable names
- Add JSDoc comments for public methods
- Emit events for important operations
- Handle errors gracefully
- Use async/await for async operations
- Inject dependencies rather than requiring them directly

## Security

### API Key Authentication

```javascript
const options = {
  apiKeys: ['key1', 'key2'],
  requireApiKey: true,
  excludePaths: ['/public', '/health']
};

// Requests must include header:
// Authorization: Bearer <api-key>
```

### Route Permissions

Every `/services/*/api` route declares the permission it needs in
`src/authservice/config/routePermissions.js`, for example
`'POST /services/filing/api/upload/*': 'filing:write'`. Permissions are
`service:action`. The gate matches a request to its most specific declaration.

| Role | Grants |
|---|---|
| `admin` | everything (`*`) |
| `editor` | `filing:*`, `searching:*`, `dataservice:*`, `caching:*`, `queueing:*`, `logging:read`, `measuring:read`, `profile:*` |
| `user` | `filing:read`, `searching:read`, `profile:*` |

Roles are set in `src/authservice/modules/permissions.js` (`ROLE_PERMISSIONS`).

In strictAuth mode, the default in production, a route with no declaration is refused
for everyone except admins, and start-up fails. Set `security.strictAuth` to override:

```javascript
serviceRegistry.initialize(app, eventEmitter, {
  security: { strictAuth: true }
});
```

API keys and tokens carry scopes. A plain string key is a full-access key. An object
key `{ key, name, scopes: ['queueing:*'] }` reaches only those permissions. A personal
access token may be narrowed the same way when it is created (see the Auth Service
section).

### OAuth Integration

```javascript
const auth = serviceRegistry.authservice('google', {
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://localhost:3001/auth/callback'
});
```

### Session Security

```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,  // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));
```

## Deployment

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001

CMD ["npm", "start"]
```

```bash
docker build -t digital-tech-core .
docker run -p 3001:3001 -e PORT=3001 digital-tech-core
```

### Environment Variables

Set these in your deployment environment:

```bash
PORT=3001
NODE_ENV=production
API_KEYS=your-api-keys-here
SESSION_SECRET=your-session-secret
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `SESSION_SECRET`
- [ ] Configure API keys
- [ ] Confirm start-up passes the route-declaration check (strictAuth is on in production)
- [ ] Use external caching (Redis) instead of in-memory
- [ ] Use external database (MongoDB) instead of file storage
- [ ] Enable HTTPS
- [ ] Set up logging aggregation
- [ ] Configure monitoring and alerts
- [ ] Implement rate limiting
- [ ] Use process manager (PM2)

## Contributing

To contribute to this project:

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Write tests for your changes
3. Run tests to ensure they pass: `npm test`
4. Commit with descriptive messages
5. Push to your branch
6. Open a pull request

## License

ISC

## Support

For issues, questions, or contributions, please contact the NooblyJS Team or open an issue in the repository.

## Version

Current version: 1.0.10

Node.js requirement: >= 12.11.0
