---
type: Steering Doc
title: Product Requirements Document
description: Provide a unified, extensible backend framework that abstracts complex infrastructure concerns while maintaining flexibility to integrate with any provider or technology stack.
---

# Product Requirements Document
## NooblyJS Core - Enterprise Node.js Backend Framework

**Document Version**: 1.0
**Last Updated**: 2025-11-22
**Status**: Active

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Product Overview](#product-overview)
3. [Architecture & Design](#architecture--design)
4. [Service Catalog](#service-catalog)
5. [Core Features](#core-features)
6. [API Specification](#api-specification)
7. [Technical Stack](#technical-stack)
8. [Configuration & Deployment](#configuration--deployment)
9. [Security Architecture](#security-architecture)
10. [Testing & Quality Assurance](#testing--quality-assurance)
11. [Monitoring & Observability](#monitoring--observability)
12. [Roadmap & Future Enhancements](#roadmap--future-enhancements)

---

## Executive Summary

**NooblyJS Core** is an enterprise-grade, modular Node.js backend framework providing a comprehensive microservices platform with 17 independently deployable services. Built on proven design patterns (Singleton, Factory, Dependency Injection), it enables rapid development of scalable, cloud-native applications with built-in support for authentication, caching, data persistence, AI integration, and workflow orchestration.

### Key Value Propositions

- **Time-to-Market**: Pre-built services eliminate boilerplate; focus on business logic
- **Scalability**: Multi-cloud support (AWS, Azure, GCP) with horizontal scaling
- **Flexibility**: 52+ provider implementations across services for diverse backend needs
- **Enterprise-Ready**: Built-in authentication, authorization, monitoring, analytics
- **Developer Experience**: Automatic dependency injection, event-driven communication, comprehensive REST APIs
- **AI-Integrated**: one AI API (AI Service v2: `complete`, `stream`, tools, `embed`, budgets) for Anthropic, OpenAI-compatible, AWS Bedrock, Google Vertex AI and Azure, plus the older Claude, OpenAI, Ollama and Gemini providers
- **AI-native development**: an MCP server so coding agents can operate a running app, a knowledge service for cited answers over documents, semantic search, a CLI (`create`, `add`, `doctor`, typed clients), one validated OpenAPI 3.1 document, and a test kit with provider contracts
- **Production-Ready**: Comprehensive testing, security middleware, performance optimization

### Target Users

- Enterprise development teams building microservices platforms
- SaaS applications requiring multi-tenant features
- Cloud-native applications needing flexible backend infrastructure
- Teams leveraging AI/LLM capabilities in backend services
- Organizations requiring workflow orchestration and task scheduling

---

## Product Overview

### Vision

Provide a unified, extensible backend framework that abstracts complex infrastructure concerns while maintaining flexibility to integrate with any provider or technology stack.

### Core Objectives

1. **Reduce Development Complexity**: Provide reusable, battle-tested service implementations
2. **Enable Cloud Agility**: Support multiple cloud platforms without vendor lock-in
3. **Ensure Scalability**: Design for horizontal scaling from day one
4. **Facilitate Integration**: Easy service-to-service communication and event handling
5. **Promote Best Practices**: Enforce SOLID principles, clean architecture, design patterns
6. **Support Modern AI**: Seamless AI/LLM integration for intelligent applications

### Success Metrics

- Reduced time to MVP by 60%+ for new microservices projects
- Support for 10+ cloud providers and storage backends
- 99.9%+ uptime in production deployments
- Zero critical security vulnerabilities
- <200ms response time for core API operations
- Support for 1,000+ concurrent connections per service instance
- >95% test coverage across all services

---

## Architecture & Design

### Architectural Paradigm

**Layered Microservices Architecture with Service Registry Pattern**

The framework implements a 5-level hierarchical architecture where services are organized by dependency relationships, ensuring clear separation of concerns and manageable dependency graphs.

### Design Principles

1. **Single Responsibility**: Each service handles one specific domain
2. **Dependency Inversion**: High-level modules depend on abstractions, not concrete implementations
3. **Open/Closed**: Services open for extension (new providers), closed for modification
4. **Liskov Substitution**: Provider implementations are interchangeable
5. **Interface Segregation**: Small, focused service interfaces
6. **DRY (Don't Repeat Yourself)**: Shared patterns, utilities, and base classes

### Architectural Layers

```
┌─────────────────────────────────────────────────────┐
│ Level 4: Integration Layer                          │
│ ┌─────────────────────────────────────────────────┐ │
│ │ AuthService | AIService                         │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
             ↑ Depends on
┌─────────────────────────────────────────────────────┐
│ Level 3: Application Layer                          │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Scheduling | Searching | Workflow | Filing     │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
             ↑ Depends on
┌─────────────────────────────────────────────────────┐
│ Level 2: Business Logic Layer                       │
│ ┌─────────────────────────────────────────────────┐ │
│ │ DataService | Working | Measuring              │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
             ↑ Depends on
┌─────────────────────────────────────────────────────┐
│ Level 1: Infrastructure Layer                       │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Caching | Queueing | Notifying | Fetching      │ │
│ │ AppService | Settings                           │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
             ↑ Depends on
┌─────────────────────────────────────────────────────┐
│ Level 0: Foundation Layer                           │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Logging Service                                 │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Key Architectural Components

#### Service Registry Pattern

The `ServiceRegistry` singleton manages:
- Service lifecycle and instantiation
- Dependency injection and resolution
- Circular dependency detection
- Multi-instance management with named instances
- Event broadcasting for service lifecycle events
- Service discovery and introspection

```javascript
// Usage pattern
const registry = require('./index.js');
const logger = registry.logging('file', { dependencies: {} });
const cache = registry.caching('redis', {
  dependencies: { logging: logger },
  instanceName: 'session-cache'
});
```

#### Factory Pattern Implementation

Each service exports a factory function:
```javascript
module.exports = (providerType, options = {}, eventEmitter) => {
  const { dependencies = {} } = options;
  // Service implementation
  return serviceInstance;
};
```

#### Dependency Injection Container

Services receive dependencies as configuration:
```javascript
const service = createService(providerType, {
  dependencies: {
    logging: loggerService,
    caching: cachingService,
    // ... other dependencies
  },
  // Service-specific options
}, eventEmitter);
```

#### Event-Driven Communication

Global EventEmitter enables inter-service communication:
```javascript
eventEmitter.emit('service:created', {
  serviceName,
  providerType,
  timestamp
});

eventEmitter.on('cache:set', (data) => {
  // React to cache operations
});
```

### Scalability Architecture

#### Horizontal Scaling
- **Stateless Service Design**: Services don't maintain client state
- **Shared Infrastructure**: External cache, database, message queue
- **Load Balancing**: Services deployed behind load balancers
- **Multi-Instance Support**: Named instances for different configurations

#### Vertical Scaling
- **Provider Selection**: Choose most performant provider for use case
- **Connection Pooling**: Database and queue connection management
- **Caching Strategy**: Multi-level caching to reduce latency
- **Batch Processing**: Queue batch operations for throughput

#### Cloud-Native Architecture
- **Container Ready**: Docker-compatible with health checks
- **Kubernetes Support**: Stateless design works with Kubernetes
- **Service Mesh Compatible**: Event-driven design works with service meshes
- **Serverless Compatible**: Designed for deployment in serverless environments

---

## Service Catalog

### Level 0: Foundation Services

#### **Logging Service** (`src/logging/`)
Central logging and monitoring hub for the entire platform.

**Purpose**: Capture, store, and analyze application events and metrics

**Providers Available** (3):
1. **Memory** - In-process logging for development
2. **File** - Persistent disk-based logging
3. **API** - Remote logging backend integration

**Core Capabilities**:
- Multiple log levels (debug, info, warn, error)
- Structured metadata logging
- Analytics and metrics tracking
- Real-time log streaming
- Log rotation and archiving

**Key Methods**:
- `log(level, message, metadata)`
- `debug(message, data)`
- `info(message, data)`
- `warn(message, data)`
- `error(message, error)`
- `getAnalytics()`

**Metrics Tracked**:
- Log count by level
- Error frequency and types
- Performance timings
- Event classification

**Dependencies**: None (foundation)

**Integration Points**: Used by all 15+ other services

---

### Level 1: Infrastructure Services

#### **Caching Service** (`src/caching/`)
High-performance data caching with multiple backend support.

**Purpose**: Reduce latency and load on downstream services through intelligent caching

**Providers Available** (8):
1. **Memory** - In-process LRU cache, ideal for single-instance apps
2. **Redis** - Distributed cache for multi-instance deployments
3. **Memcached** - High-performance distributed caching
4. **File** - Persistent file-based cache with TTL support
5. **API** - Remote caching service integration
6. **AWS** - AWS ElastiCache (Redis and Memcached engines)
7. **Azure** - Azure Cache for Redis, with managed authentication
8. **GCP** - Google Cloud Memorystore (Redis and Memcached engines), with IAM authentication

**Core Capabilities**:
- Key-value storage with configurable TTL
- Cache statistics (hit rate, eviction count)
- Automatic expiration handling
- Named instances (`instanceName`) with per-instance analytics
- Cache invalidation (delete by key; list and clear through the REST API)

**Key Methods** (the provider interface; see `src/caching/providers/caching.js`):
- `put(key, value)` - Set cache entry
- `get(key)` - Retrieve cache entry
- `delete(key)` - Remove cache entry
- `getAnalytics()` - Get cache statistics
- `getSettings()` / `saveSettings(settings)` - Read and persist service settings

**Dependencies**: Logging

**Use Cases**:
- Session storage
- API response caching
- Database query result caching
- User preference caching
- Rate limiting counters

---

#### **Queueing Service** (`src/queueing/`)
Asynchronous message processing and task distribution.

**Purpose**: Enable reliable, asynchronous processing of long-running tasks and event distribution

**Providers Available** (8):
1. **Memory** - In-process queue for development/testing
2. **Redis** - Distributed queue with pub/sub
3. **RabbitMQ** - Message broker with advanced routing
4. **ActiveMQ** - Apache ActiveMQ-backed FIFO queue with analytics
5. **AWS SQS** - Cloud-native queue service
6. **Azure Queue Storage** - Azure-managed queue
7. **GCP Pub/Sub** - Google Cloud event streaming
8. **API** - Remote queue service

**Core Capabilities**:
- FIFO message ordering
- Batch message processing
- Dead-letter queue support
- Message priorities
- Automatic retry handling
- Message persistence

**Key Methods**:
- `enqueue(queueName, item)` - Add a message (reliable options when the provider supports them)
- `dequeue(queueName)` - Take the next message
- `size(queueName)` - Messages waiting
- `listQueues()` - Queue names
- `purge(queueName)` - Clear a queue

**Dependencies**: Logging

**Use Cases**:
- Task scheduling
- Email/notification delivery
- Batch data processing
- Event streaming
- Workflow orchestration
- Rate limiting

---

#### **Notifying Service** (`src/notifying/`)
In-process topic messaging, plus outbound webhooks with signed deliveries.

**Purpose**: Deliver notifications between parts of an application, and to external systems through signed webhooks

**Providers Available** (2):
1. **Default** - In-process topics, with a notification history
2. **API** - Proxies to a remote notifying service

**Core Capabilities**:
- Topic messaging: `createTopic`, `subscribe(topic, callback)`, `unsubscribe`, `notify`, `getNotifications`
- Outbound webhooks (feature 12): subscriptions with a secret, deliveries on the reliable queue, a delivery history, and redelivery. Each request is signed with `NooblyJS-Signature`.
- REST and dashboard for webhook subscriptions and deliveries

**Key Methods** (webhooks, `src/notifying/modules/webhooks.js`):
- `subscribe(input)`, `list()`, `unsubscribe(id)` - manage subscriptions
- `publish(event, payload)` - queue an event for every matching subscription
- `redeliver(deliveryId)`, `deliveries(limit)` - retry and inspect deliveries

**Dependencies**: Logging, Queueing, Settings (webhook deliveries and subscriptions are stored in settings)

**Use Cases**:
- User notifications and system alerts
- Webhooks to partner systems, with signed, retried delivery
- Coordinating email or SMS delivery through the transactional outbox (dataservice `addWithEvent` and `relayOutbox`, MongoDB)

---

#### **Fetching Service** (`src/fetching/`)
HTTP request handling with built-in caching and resilience.

**Purpose**: Provide reliable HTTP communication with automatic caching and error recovery

**Providers Available** (2):
1. **Node.js** - Native http/https modules
2. **Axios** - Promise-based HTTP client

**Core Capabilities**:
- HTTP/HTTPS requests
- Request/response caching
- Automatic retry logic
- Timeout handling
- Request transformation
- Response parsing (JSON, text, binary)

**Key Methods**:
- `get(url, options)` - GET request
- `post(url, data, options)` - POST request
- `put(url, data, options)` - PUT request
- `delete(url, options)` - DELETE request
- `request(config)` - Custom request

**Caching Strategy**:
- GET requests cached by default
- Configurable cache TTL per request
- Cache bypassing option
- Conditional request support

**Dependencies**: Logging

**Use Cases**:
- Third-party API integration
- Microservice-to-microservice communication
- Webhook delivery
- Data fetching pipelines

---

#### **AppService** (`src/appservice/`)
Foundation for custom application services.

**Purpose**: Provide base classes and utilities for building custom services

**Components**:
- `AppBase` - Base class for services
- `AppDataBase` - Data-aware service base
- `AppRouteBase` - Route handler base
- `AppServiceBase` - Full-featured service base
- `AppViewBase` - View/UI handler base
- `AppWorkerBase` - Worker/task base

**Dependencies**: Logging

**Use Cases**:
- Extending framework with custom services
- Creating domain-specific services
- Implementing custom business logic

---

#### **Settings Service** (`src/settings/`)
Grouped key/value settings, with the option to store them encrypted.

**Purpose**: Hold application configuration and secrets in one place, with an embeddable management UI

**Providers Available** (2):
1. **File** - Settings in a JSON file
2. **Encrypted** - The same store, AES-256-GCM encrypted. The master secret comes from `options.secret`, `SETTINGS_SECRET` or `SESSION_SECRET`.

**Capabilities**:
- Grouped settings, with validation on the REST API (400 for invalid input)
- Feature flags (feature 13) live in the `flags` group: evaluated through the `flags:evaluate` permission, exposed as an OpenFeature provider, and managed from a dashboard panel
- Embeddable UI: `new SettingsUIManager({ containerId }).initialize()` from `/services/settings/scripts/js/index.js`
- Reload from disk through the REST API

**Dependencies**: Logging

---

### Level 2: Business Logic Services

#### **DataService** (`src/dataservice/`)
Unified data persistence layer with multi-database support.

**Purpose**: Abstract database operations and provide consistent CRUD interface across providers

**Providers Available** (6):
1. **Memory** - In-process data store for development
2. **File** - JSON-based persistent storage
3. **MongoDB** - Document database
4. **DocumentDB** - AWS-managed MongoDB
5. **SimpleDB** - AWS key-value store
6. **API** - Remote data service

**Core Capabilities**:
- CRUD operations (Create, Read, Update, Delete)
- Advanced querying with filtering
- Nested data queries (dot notation)
- Bulk operations
- Transaction support (MongoDB)
- Automatic ID generation
- Indexing support

**Key Methods**:
- `add(collection, data)` - Create item
- `remove(collection, id)` - Delete item
- `find(collection, query)` - Find items
- `update(collection, id, data)` - Update item
- `list(collection)` - List all items
- `count(collection)` - Count items
- `jsonFind(collection, path, value)` - Query by path
- `jsonFindByPath(collection, path)` - Get by path

**Query Capabilities**:
- Simple property matching
- Nested path queries (e.g., `address.city`)
- Regex pattern matching
- Criteria-based filtering
- Sorting and pagination

**Dependencies**: Logging, Queueing

**Use Cases**:
- User data storage
- Application configuration
- Session data
- Audit logs
- Business entity storage

---

#### **Working Service** (`src/working/`)
Runs activities (small scripts) in worker threads, outside the request cycle.

**Purpose**: Run long or CPU-heavy work without blocking requests, with queued tasks and results.

**Providers**: `default` (worker threads) and `api` (proxies to a remote working service).

**Capabilities**:
- Starts an activity from a script path under the activities folder, or a named activity
- Keeps tasks on a queue, with a bounded number of threads (`maxThreads`)
- Reports status and results through a completion callback
- Refuses activity folders that overlap a filing store, and paths that leave the activities folder (feature 18)
- Reliable tasks are acknowledged only when their worker finishes

**Key Methods** (`src/working/providers/working.js`):
- `start(scriptPath, data, completionCallback, startOptions)` - run a script
- `startActivity(name, data, completionCallback)` - run a named activity
- `hasActivity(name)`, `hasActivityRegistry()` - check what is available
- `validateActivityPath(path)`, `assertActivityPath(path)` - refuse unsafe paths
- `stop()` - stop the processor and fail anything still waiting

**Activity contract**: a CommonJS module that exports `run(data)`. The worker's result is what `run` returns; a thrown error is reported as an error status.

```javascript
// activities/greet.js
exports.run = async (data) => ({ greeting: `Hello, ${data.name}` });
```

**Dependencies**: Logging, Queueing, Caching

**Use Cases**:
- Background job processing
- Report generation and file processing
- Steps of a workflow (a workflow step names an activity; unsafe steps are refused)
- Scheduled tasks (the scheduling service starts activities)

---

#### **Measuring Service** (`src/measuring/`)
Records numeric measures over time and reports totals and averages.

**Purpose**: Keep counts and values such as requests, errors and durations, and report them over a period

**Providers**: `default` (in memory) and `api` (proxies to a remote measuring service).

**Key Methods** (`src/measuring/provider/measuring.js`):
- `add(metricName, value)` - record a measure with its timestamp
- `list(metricName, startDate, endDate)` - measures in a period
- `total(metricName, startDate, endDate)` - sum in a period
- `average(metricName, startDate, endDate)` - mean in a period

Either date may be omitted. `total('visits')` covers all time; a start date alone keeps measures from that point on, and an end date alone keeps measures up to it.

**Dependencies**: Logging, Queueing, Caching

**Use Cases**:
- Request and error counts
- Durations and sizes for performance monitoring
- Usage reports, fed to the dashboard

---

#### **Scheduling Service** (`src/scheduling/`)
Runs activities on a cron expression or at an interval.

**Purpose**: Run recurring tasks reliably, with pause, resume and a run history

**Providers**: one in-process scheduler per process (`registry.scheduling()` returns the same instance on every call).

**Capabilities**:
- Interval tasks: `start(name, scriptPath, intervalSeconds, ...)` fires immediately, then every interval
- Cron tasks: `startCron(task, cron, name, callback)` with a standard 5-field expression (minute, hour, day of month, month, day of week)
- Pause and resume; minutes skipped while paused are not replayed on resume
- `update(name, changes)` switches a task between cron and interval without losing its callback or history
- Run history: `listRuns` and `getRun` keep the last 50 runs per task, including fires skipped at the concurrency cap
- `getStats()` for the dashboard and the monitoring endpoints

**Key Methods** (`src/scheduling/providers/scheduling.js`):
- `start(taskName, scriptPath, dataOrInterval, intervalSecondsOrCallback, executionCallback, options)`
- `startCron(task, cron, taskName, callback)`
- `runNow(taskName)`, `pause(taskName)`, `resume(taskName)`, `update(taskName, changes)`
- `cancel(taskId)`, `stop(taskName)`, `isRunning(taskName)`
- `listSchedules()`, `getSchedule(taskName)`, `listRuns(...)`, `getRun(...)`, `getStats()`

**Cron example**:
```
0 */5 * * *     every five minutes
0 0 * * *       every day at midnight
0 0 * * 0       every Sunday at midnight
```

**Dependencies**: Logging, Working (the scheduler starts activities through the working service)

**Use Cases**:
- Data cleanup and retention
- Report generation on a schedule
- Cache warming
- Periodic health checks
- Scheduled workflow runs

---

#### **Searching Service** (`src/searching/`)
Full-text search with result caching and intelligent indexing.

**Purpose**: Provide fast, flexible search capabilities across large datasets

**Capabilities**:
- Full-text search
- Semantic (meaning) and hybrid search with the `vector` provider: embeddings from the AI service's `embed()` or a built-in hash backend, background embedding with `flushEmbeddings()`, keyword fallback when embedding fails (`search:embed:error`)
- Ranking evaluation (`POST /services/searching/api/evaluate`): recall@k and mean reciprocal rank for labelled queries
- Keyword filtering
- Result ranking and sorting
- Pagination support
- Search result caching
- Faceted search
- Custom search filters

**Key Methods**:
- `search(query, options)` - Execute search
- `add(key, document)`, `addAll(documents)`, `replace(document)`, `remove(key)` - Maintain the index
- `suggest(...)`, `autoSuggest(...)` - Suggestions as the user types
- `getStats()` - Get search statistics
- `saveToDisk()`, `loadFromDisk()` - Persist and restore indexes

**Search Features**:
- Prefix matching
- Boolean operators (AND, OR, NOT)
- Phrase search
- Wildcard support
- Fuzzy matching (provider dependent)

**Dependencies**: Logging. The registry injects no other service. Caching, DataService, Queueing, Working and Scheduling are optional collaborators that an application wires in itself.

**Use Cases**:
- Product catalog search
- Document search
- User directory search
- Knowledge base search
- Log search and analysis

---

#### **Workflow Service** (`src/workflow/`)
Runs named, multi-step workflows. Each step is an activity run by the working service.

**Purpose**: Define a sequence of activities, run it on demand or on a schedule, and keep its history

**Providers**: `memory` (all state in memory, persisted by the host) and `api`.

**Capabilities**:
- Define, update, star, import and export workflows (identified by name)
- Run a workflow on demand, with input and a status callback; `startExecution` returns at once
- Schedules: a workflow can run on a cron expression (it reuses the scheduling cron parser)
- Execution history, capped per workflow (`maxExecutionsPerWorkflow`, default 1000)
- State snapshot: `exportState()` and `importState()`. On import, runs that were in progress become interrupted failures, and overdue schedules are caught up once. A `workflow:state:changed` event tells the host when to save.
- Steps are checked before a workflow is defined: a step that the working service would refuse (for example a path outside the activities folder) is rejected with `400`

**Key Methods** (`src/workflow/index.js`):
- `defineWorkflow(name, steps, metadata)`, `createWorkflow(data)`, `updateWorkflow(name, changes)`, `deleteWorkflow(name)`
- `runWorkflow(name, data, statusCallback, options)`, `executeWorkflow(name, input, options)`, `startExecution(name, input, options)`
- `getExecution(id)`, `listExecutions(...)`
- `listWorkflows(...)`, `getWorkflow(name)`, `setStarred(name, starred)`, `markViewed(name)`
- `exportWorkflow(name)`, `importWorkflow(data, options)`, `exportState()`, `importState(snapshot)`

**Definition example**:
```javascript
await workflow.defineWorkflow('greet-flow', ['greet.js']);
const execution = await workflow.runWorkflow('greet-flow', { name: 'Ada' });
```

**Dependencies**: Logging, Queueing, Scheduling, Measuring, Working

**Use Cases**:
- Data pipelines (extract, transform, load) built from activities
- Scheduled reports and housekeeping
- Multi-step business processes with a visible history
- Approval flows (with the agentic workflow feature when it ships; see the roadmap)

---

#### **Filing Service** (`src/filing/`)
File operations across multiple storage backends.

**Purpose**: Provide unified file operations API across local and cloud storage

**Providers Available** (7):
1. **Local** - Local filesystem operations
2. **FTP** - Remote FTP server access
3. **S3** - Amazon S3 storage
4. **Git** - Git repository operations
5. **GCP Storage** - Google Cloud Storage
6. **Sync Provider** - Bidirectional file synchronization
7. **API** - Remote filing service

**Core Capabilities**:
- File upload/download
- Directory operations
- File metadata management
- Streaming support for large files
- Version control (Git provider)
- Cloud synchronization
- Batch operations

**Key Methods**:
- `upload(remotePath, localPath)` - Upload file
- `download(remotePath, localPath)` - Download file
- `list(remotePath)` - List directory
- `delete(remotePath)` - Delete file
- `copy(sourcePath, destPath)` - Copy file
- `move(sourcePath, destPath)` - Move file

**Cloud Sync Features** (Git Provider):
- Clone repository
- Commit changes
- Push to remote
- Pull latest changes
- Branch management

**Dependencies**: Logging, Queueing, DataService

**Use Cases**:
- User file storage
- Document management
- Backup and archival
- Media processing
- Version control integration

---

### Level 4: Integration Services

#### **AuthService** (`src/authservice/`)
User authentication and authorization system.

**Purpose**: Provide comprehensive authentication and session management

**Providers Available** (7):
1. **File** - JSON file-based user storage
2. **Memory** - In-process user storage
3. **Passport** - Passport.js authentication framework
4. **Google OAuth** - Google OAuth 2.0 integration
5. **Azure** - Azure AD (Entra ID) sign-in
6. **Secure Email** - Email plus pre-shared secure key sign-in for Teams and Edge extensions
7. **API** - Remote authentication service

**Core Capabilities**:
- User registration and login
- Password hashing and verification
- Session management
- JWT token generation
- OAuth 2.0 flow support
- User profile management
- Role-based access control (RBAC)
- Permission management

**Key Methods**:
- `createUser(userData)` - Create a user
- `authenticateUser(email, password)` - Sign in and create a session
- `validateSession(token)` - Check a session token
- `logout(token)` - End a session
- `getUser(email)`, `updateUser(email, updates)` - Read and update a user
- `changePassword(email, currentPassword, newPassword)` - Change a password; revokes the user's sessions
- `createApiToken(email, tokenName, options)`, `validateApiToken(value)` - Personal access tokens
- `createInvitation`, `approveInvitation`, `redeemInvitation(code, password)` - Invitations

**Session Management**:
- HTTPOnly cookies by default
- Configurable session TTL
- Session persistence option
- Automatic session cleanup

**Security Features**:
- Bcrypt password hashing
- CSRF protection support
- Secure token generation
- OAuth state parameter validation
- Session fixation prevention

**Dependencies**: Logging, Caching, DataService

**Use Cases**:
- User login/logout
- Multi-factor authentication preparation
- API access control
- User onboarding
- Account management

---

#### **AIService** (`src/aiservice/`)
One API for calling AI models, with streaming, tools, structured output and embeddings.

**Purpose**: Give application code one way to call every model provider, with token and cost limits

**Providers (AI Service v2)**: `anthropic`, `openai-compatible`, `bedrock`, `vertex`, `azure` and `mock`. They use the shared module in `src/aiservice/common/` (`nooblyjs-ai-common`, no dependencies), which also carries the model catalogue, discovery, token estimates, cost, retry and SSE.

**Removed in 2.0.0**: the `claude` (default), `openai` (alias `chatgpt`), `ollama` and `gemini` providers. Use `anthropic` for Claude, or `openai-compatible` with a `baseUrl` for OpenAI, Ollama and Gemini. The default provider is `anthropic`. **Still present**: `openai-kv` (Azure OpenAI through Azure Key Vault) and `tensorflow` (experimental), which keep `prompt()`.

**Key Methods** (v2 bridge, `src/aiservice/provider/aiCommon.js`):
- `complete(request)` - a single reply with usage
- `streamToResponse(res, request)` - a streamed reply over server-sent events
- `generateObject(request)` - asks for JSON that follows a schema and returns the parsed object; a reply that is not JSON is refused with `422`
- `embed(texts, options)` and `embedder()` - embeddings for semantic search and knowledge
- `listModels()` - the models available to the configured provider
- `prompt(prompt, options)` - legacy call, kept for the older providers

**Limits**: `budgets.maxTokensPerRequest` (default 8192) and `budgets.maxCostPerDay` (default unlimited). A request that would exceed either is refused before it is sent.

**Model catalogue**: the shared module lists current models for each provider (for example the Claude 5 family, GPT-5.6, Gemini 2.5 and 3.x, Grok 4.x, DeepSeek). Check `models.js` in the shared module for the current list and prices.

**Dependencies**: Logging, Caching, Workflow, Queueing

**Use Cases**:
- Content generation and summarization
- Classification, tagging and structured extraction
- Question answering over a knowledge base (with the knowledge service)
- Agent-style tool use (with the MCP endpoint and workflows)

---

### Level 5: Knowledge Services

#### **Knowledge** (`src/knowledge/`)
Answers questions from documents, with citations (retrieval-augmented generation).

**Purpose**: let a team ship "ask our docs" over any filing source in a day.

**Provider**: `default` (`registry.knowledge()`), built from filing, a vector search instance of its own and the AI service.

**Core Capabilities**:
- Sync Markdown, text, HTML and PDF files from a filing folder; heading-aware chunks; only changed files are re-embedded, deleted files lose their chunks; unreadable files are listed as skipped
- Hybrid retrieval and answers that cite sources by number; an uncited answer is marked `low`
- Streamed answers over server-sent events
- Access rules: `access(path)` returns the roles a file is open to; chunks a caller may not read never reach the model
- Feedback (good or bad ratings) and evaluation from YAML cases: recall@k, mean reciprocal rank, citation accuracy
- Saved state (`restore: true`) and folder watching (`watch: true`)
- Dashboard at `/services/knowledge/` (Ask, Sources, Quality)

**Key Methods**: `sync`, `retrieve`, `ask`, `streamAnswer`, `askStream`, `recordFeedback`, `listFeedback`, `evaluate`, `sources`, `status`

**Dependencies**: Logging, Filing, Searching, AIService

---

> Note: the earlier "Requesting Service" entry described a planned request router. It was never built and has been removed. Request routing is provided by Express and the per-service routes.

---

## Cross-Cutting Capabilities

These are not services in the registry's dependency graph, but applications rely on them.

### MCP Server (`src/mcp/`)
- **What**: a Model Context Protocol endpoint at `POST /services/mcp` (JSON-RPC over Streamable HTTP), so coding agents such as Claude Code can read logs, queues, data and workflow runs of a running app
- **Off by default**: enabled with `mcp.enabled`; write tools also need `mcp.allowWrite` and the admin wildcard
- **Permissions**: every tool repeats the permission check of the REST route it mirrors; a caller must be identified
- **Stdio bridge**: `nooblyjs mcp` connects a stdio-based agent to a running app

### OpenAPI and Typed Clients (`src/shared/utils/openapi.js`)
- **What**: one merged OpenAPI 3.1 document from every service's `routes/swagger/docs.json`, at `GET /services/api/openapi.json` (and `.yaml`), with Swagger UI at `/services/api/docs`
- **Drift**: every route must be documented; an undocumented route fails the OpenAPI test
- **Clients**: `nooblyjs openapi --client ts` writes a typed TypeScript client; CI compiles it with `tsc --strict`

### Developer CLI (`src/cli/`, `bin/nooblyjs.js`)
- `create` (templates `api`, `dashboard`, `ai`), `add endpoint|service|provider`, `doctor`, `routes`, `openapi`, `keys generate`, `mcp`
- `add provider` works in a core checkout and writes the provider's contract test

### Telemetry (`src/telemetry/`)
- **What**: OpenTelemetry tracing across HTTP requests, queue messages, workers and AI calls (GenAI attributes)
- **Off by default**: `telemetry: { enabled: true }`; exporter `console`, `otlp` or `memory`; `OTEL_SDK_DISABLED` turns it off and `OTEL_EXPORTER_OTLP_ENDPOINT` sets the collector
- **Dependencies**: the OpenTelemetry packages are optional peers

### Test Kit and Contracts (`src/testing/`, `testing.js`)
- `nooblyjs-core/testing` gives application tests a registry (`createTestRegistry()`), event matchers (`installMatchers()`) and an event recorder (`EventRecorder`)
- Provider contract suites in `tests/contract/` run the same expectations against every provider of a service (caching, queueing, dataservice, filing, searching, authservice)

### Shared Modules
- **Shared AI module** (`src/aiservice/common/`): see AIService
- **Feature flags**: see Settings
- **UI kit** (`public/ui/`): the frame and components that the NooblyJS AI host draws hosted apps into
- **Filing store and activities boundary**: the working service refuses an activities folder that overlaps a filing store

---

## Core Features

### 1. Dependency Injection & Service Registry

**Automated Dependency Resolution**: Services automatically receive required dependencies without manual wiring.

```javascript
// Automatic dependency resolution
const cache = registry.cache('redis', {
  dependencies: {
    logging: logService
    // Automatically resolved if not provided
  }
});
```

**Features**:
- Circular dependency detection
- Lazy dependency loading
- Dependency validation
- Named instance management
- Service discovery

### 2. Event-Driven Architecture

**Global Event Broadcasting**: All services communicate via event emitter for loose coupling.

**Standard Events**:
```javascript
'service:created'      // Service initialized
'service:destroyed'    // Service shutdown
'cache:set'           // Cache operation
'cache:hit'           // Cache hit
'cache:miss'          // Cache miss
'queue:push'          // Message queued
'queue:pop'           // Message dequeued
'workflow:started'    // Workflow started
'workflow:completed'  // Workflow completed
'workflow:failed'     // Workflow failed
'data:created'        // Data item created
'data:updated'        // Data item updated
'data:deleted'        // Data item deleted
'error'               // Error occurred
```

**Usage**:
```javascript
eventEmitter.on('cache:hit', (data) => {
  measuring.record('cache.hits', 1, { provider: data.provider });
});
```

### 3. Multi-Provider Architecture

**Pluggable Providers**: Swap implementations without code changes.

```javascript
// Development: Memory cache
const cache = registry.cache('memory');

// Production: Redis
const cache = registry.cache('redis', {
  host: 'redis.example.com',
  port: 6379
});

// Switch providers by changing configuration only
```

**Provider Categories** (52+ total):
- Caching (5 providers)
- Queueing (7 providers)
- DataService (6 providers)
- Filing (6 providers)
- AuthService (5 providers)
- AIService (4 providers)
- Logging (3 providers)
- Fetching (2 providers)
- Notifying (2 providers)

### 4. REST API Auto-Generation

**Automatic Route Registration**: Services automatically expose REST APIs.

**Benefits**:
- Reduced boilerplate code
- Consistent API patterns
- Built-in documentation
- Auto-generated Swagger specs (selected services)

**API Structure**:
```
/services/{serviceName}/api/        # Service APIs
/services/{serviceName}/             # Service UI/dashboard
/services/api/monitoring/            # System monitoring
```

### 5. Built-in Monitoring & Observability

**Metrics Collection**: Automatic metrics for all operations.

**Available Metrics**:
- Request count and latency
- Cache hit/miss rates
- Queue depth and processing time
- Database operation metrics
- Error rates and types
- Service availability

**Monitoring Endpoints**:
```
GET /services/api/monitoring/metrics   # System metrics
GET /services/api/monitoring/snapshot   # Current state
```

### 6. Named Service Instances

**Multiple Configurations**: Run multiple instances of same service independently.

```javascript
// Session cache (short TTL)
const sessionCache = registry.cache('redis', {
  instanceName: 'session-cache',
  ttl: 3600
});

// Data cache (long TTL)
const dataCache = registry.cache('redis', {
  instanceName: 'data-cache',
  ttl: 86400
});

// Retrieve specific instance
const session = registry.getServiceInstance('caching', 'redis', 'session-cache');
```

### 7. Security Middleware

**Built-in Authentication**: API key and session-based authentication.

**Features**:
- API key validation
- JWT token verification
- Session authentication
- CSRF protection support
- Configurable path exclusions
- Rate limiting ready

**Configuration**:
```javascript
const options = {
  security: {
    apiKeyAuth: {
      apiKeys: ['key1', 'key2'],
      requireApiKey: true,
      excludePaths: ['/health', '/status']
    },
    servicesAuth: {
      requireLogin: true
    }
  }
};
```

### 8. Comprehensive Testing Framework

**Test Types**:
- Unit tests (Jest, with an enforced coverage threshold: 76% statements, actual 78% on 2026-11-13)
- node:test suites for the ESM AI module and the AI Service v2 bridge (`npm run test:ai-common`)
- Provider contract suites (`tests/contract/`): caching, queueing, filing, dataservice, searching, authservice; Redis and MongoDB run in CI service containers
- Playwright UI tests on desktop and mobile Chromium, including a check that every dashboard click handler resolves
- Security regression suites, a generated authorization matrix, OWASP ZAP baseline and gitleaks in CI
- OpenAPI validation against the OpenAPI 3.1 schema, with the typed client compiled under `tsc --strict`
- Load tests

**Test Utilities**:
- Test kit for apps (`nooblyjs-core/testing`): a registry with in-memory services, event matchers, authenticated requests, cleanup under `.temp/`
- Mock EventEmitter and providers
- Supertest for HTTP testing

### 9. Error Handling & Recovery

**Graceful Error Handling**: Standardized error handling across services.

**Features**:
- Error classification (validation, authentication, business logic)
- Error event broadcasting
- Error logging with context
- Recovery strategies
- Timeout handling

### 11. AI-Native Developer Tooling

- **MCP server** (`POST /services/mcp`, off unless `mcp.enabled`): read tools for logs, queues, data, search, workflow runs, schedules and monitoring; write tools only with `mcp.allowWrite` and an admin; prompts such as `diagnose-failed-run`. Each tool checks the permission of the REST route it mirrors. `nooblyjs mcp` is a stdio bridge for Claude Code and other agents.
- **Developer CLI** (`npx nooblyjs`): `create` (api, dashboard and ai templates), `add endpoint`, `add service`, `add provider` (core checkout, with its contract test), `doctor` (environment, audit, Redis, MongoDB and S3 reachability), `routes`, `openapi` with a typed TypeScript client, `keys generate`.
- **OpenAPI 3.1**: one merged document for every mounted service at `/services/api/openapi.json`, every route documented, rendered at `/services/api/docs`.
- **Semantic search**: a vector provider with hybrid ranking, embeddings from the AI service, and an evaluate route for ranking quality.

### 10. Configuration Management

**Environment-Based Configuration**: Flexible configuration with environment variables.

**Configuration Options**:
```javascript
{
  port: 3001,
  nodeEnv: 'development|production',
  apiKeys: ['key1', 'key2'],
  logDir: './logs',
  dataDir: './data',
  sessionSecret: 'strong-secret',
  security: { /* ... */ },
  providers: { /* provider-specific options */ }
}
```

---

## API Specification

### Authentication

**API Key Authentication**:
```http
GET /services/caching/api/get/key
Authorization: Bearer <api-key>
```

**Session Authentication**:
```http
GET /services/authservice/api/profile
Cookie: session=<session-id>
```

### Common Response Format

**Success Response** (200 OK):
```json
{
  "success": true,
  "data": { /* operation result */ },
  "timestamp": "2025-11-22T10:30:45Z",
  "requestId": "req-123456"
}
```

**Error Response** (4xx/5xx):
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input parameters",
    "details": { /* additional error info */ }
  },
  "timestamp": "2025-11-22T10:30:45Z",
  "requestId": "req-123456"
}
```

### Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful operation |
| 201 | Created | Resource created |
| 204 | No Content | Successful, no content returned |
| 400 | Bad Request | Invalid parameters or validation error |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Service down or overloaded |

### Global API Endpoints

#### Health & Status
```
GET /services/{serviceName}/api/status        # Service status
GET /services/{serviceName}/api/health        # Health check
```

#### Monitoring (Protected)
```
GET /services/api/monitoring/metrics          # System metrics
GET /services/api/monitoring/snapshot         # Current snapshot
```

#### Authentication (Public)
```
POST /services/authservice/api/login          # User login
POST /services/authservice/api/register       # User registration
GET  /services/authservice/api/profile        # User profile (protected)
```

### Service-Specific Endpoints

See [Service Catalog](#service-catalog) for detailed endpoint documentation per service.

---

## Technical Stack

Versions below come from `package.json`. Cloud SDKs, OpenTelemetry and nodemailer are optional peer dependencies: a provider loads its SDK only when it is used (`src/shared/utils/optionalRequire.js`).

### Runtime & Web Framework
- **Node.js**: 22 or later (CI runs Node 22 and 24). The package ships CommonJS and ESM entry points with named exports (`esm/`).
- **Express.js**: 5.3 (`^5.3.0`). Route patterns that must work on Express 4 and 5 use `route()` (`src/shared/utils/routePattern.js`).
- **Security middleware**: helmet (headers and CSP), express-rate-limit, cors, bcryptjs (password hashing).
- **Nodemon**: development auto-reload.

### Data Stores (provider libraries)
| Provider | Library | Notes |
|----------|---------|-------|
| MongoDB, DocumentDB | mongodb 6.19 (peer, optional) | Document database; the transactional outbox runs here |
| SimpleDB | aws-sdk v2 (optional, not in the dev install) | AWS key-value store |
| File | none (`fs`) | Encrypted or plain JSON on disk |
| Local filing | none (`fs`) | Storage root from `FILING_BASE_DIR` |

### Caching & Message Queuing
| Provider | Library | Notes |
|----------|---------|-------|
| Redis (cache, queue, reliable jobs, session store) | ioredis 5.6 | `REDIS_URL` / `SESSION_REDIS_URL` |
| Memcached | memjs 1.3 (peer, optional) | |
| RabbitMQ | amqplib 0.10 (peer, optional) | Reliable options refused (see the roadmap) |
| ActiveMQ | stompit (peer, optional) | Reliable options refused |
| AWS SQS, Azure Queue, GCP | `@aws-sdk/client-sqs`, `@azure/storage-queue`, `@google-cloud/tasks` (peers) | Reliable options refused |

### Cloud Platform SDKs (optional peers)
| Provider | Library |
|----------|---------|
| AWS S3 and SQS | `@aws-sdk/client-s3`, `@aws-sdk/client-sqs` 3.614+ |
| Azure | `@azure/identity` 4.13+, `@azure/keyvault-secrets` 4.11+, `@azure/storage-queue` 12.26+ |
| Google Cloud | `@google-cloud/storage` 5.18+, `@google-cloud/tasks` 6.2+ |

### Observability
| Component | Library | Notes |
|-----------|---------|-------|
| OpenTelemetry tracing | `@opentelemetry/api` 1.9, `sdk-trace-node` 2.0, `exporter-trace-otlp-http` 0.200 (optional peers) | Queue propagation and GenAI attributes (feature 07) |
| Email for invitation codes | nodemailer 10.5 (optional peer) | Used only when `SMTP_URL` is set |

### AI & LLM Integration
| Provider | Library | Notes |
|----------|---------|-------|
| Shared AI module (AI Service v2) | none (`src/aiservice/common/`, plain HTTP) | Anthropic, OpenAI-compatible, Bedrock, Vertex AI, Azure, mock |
| Anthropic Claude (legacy provider) | @anthropic-ai/sdk 0.60 | Kept until 2.0.0 |
| OpenAI (legacy provider) | openai 5.23 | Kept until 2.0.0 |
| PDF text for knowledge and filing previews | pdf-parse 1.1 | |

### Authentication & Authorization
| Component | Library | Purpose |
|-----------|---------|---------|
| Passport | passport 0.7 | Auth framework |
| Google OAuth | passport-google-oauth20 2.0 | Sign-in |
| Azure AD | passport-azure-ad 4.3 | Sign-in |
| Local | passport-local 1.0 | Username and password |
| Sessions | express-session 1.17 | Session cookie (Redis or in-process store) |

### Utilities & Tools
| Component | Library | Notes |
|-----------|---------|-------|
| UUID | uuid 11 | |
| File upload | multer 2 | Limits enforced by `createUploadMiddleware` |
| Git operations | simple-git 4 | Git filing provider |
| FTP | ftp 0.3 | FTP filing provider |
| HTTP client | axios 1.7 | Fetching provider |
| YAML | js-yaml 4 | Settings and knowledge front matter |
| Environment | dotenv 17 | |

### Testing & Quality
| Tool | Library | Notes |
|------|---------|-------|
| Unit and contract tests | jest 30 | `npm test`; coverage threshold enforced in CI |
| Shared AI module tests | node:test | `npm run test:ai-common` |
| UI tests | @playwright/test 1.63 | Desktop and mobile Chromium |
| HTTP mocking and testing | nock 13, supertest 7 | |
| Type checks | typescript 5.9, @types/node 24 | `npm run check:types` |
| Dead-code check | knip 6 | |
| Dependency hygiene | Renovate; nightly `npm audit` | Feature 20 |

---

## Configuration & Deployment

### Environment Variables

```bash
# Server
PORT=3001
NODE_ENV=production

# Authentication
API_KEYS=key1,key2,key3
NOOBLYJS_API_KEYS=key1,key2,key3
SESSION_SECRET=very-long-random-string-min-32-chars

# AI Services
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# OAuth
GOOGLE_CLIENT_ID=...google...
GOOGLE_CLIENT_SECRET=...secret...

# Database
MONGODB_URI=mongodb://localhost:27017
DATABASE_NAME=digital_tech

# Cloud Credentials (if using cloud providers)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

AZURE_STORAGE_ACCOUNT_NAME=...
AZURE_STORAGE_ACCOUNT_KEY=...

GCP_PROJECT_ID=...
GCP_CREDENTIALS_PATH=...
```

### Application Initialization

```javascript
const express = require('express');
const EventEmitter = require('events');
const serviceRegistry = require('./index');

const app = express();
const eventEmitter = new EventEmitter();

// Initialize with options
const options = {
  apiKeys: process.env.API_KEYS.split(','),
  requireApiKey: true,
  logDir: './logs',
  dataDir: './data',
  security: {
    apiKeyAuth: {
      apiKeys: process.env.API_KEYS.split(','),
      requireApiKey: true,
      excludePaths: ['/health', '/status']
    }
  }
};

// Initialize services and middleware
serviceRegistry.initialize(app, eventEmitter, options);

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Create directories
RUN mkdir -p .application/logs .application/data

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/services/api/monitoring/metrics', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["npm", "start"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: digital-tech-core
spec:
  replicas: 3
  selector:
    matchLabels:
      app: digital-tech-core
  template:
    metadata:
      labels:
        app: digital-tech-core
    spec:
      containers:
      - name: api
        image: digital-tech-core:latest
        ports:
        - containerPort: 3001
        env:
        - name: PORT
          value: "3001"
        - name: NODE_ENV
          value: "production"
        - name: API_KEYS
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: api-keys
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: mongodb-uri
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /services/api/monitoring/metrics
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /services/api/monitoring/metrics
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 10
```

### Production Checklist

- [ ] Set strong SESSION_SECRET (min 32 chars)
- [ ] Configure API keys for authentication
- [ ] Set NODE_ENV=production
- [ ] Configure external database (MongoDB, DocumentDB)
- [ ] Set up Redis for distributed caching
- [ ] Configure cloud provider credentials (AWS/Azure/GCP)
- [ ] Set up logging directory with rotation
- [ ] Configure HTTPS/TLS on reverse proxy
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategy for data
- [ ] Set up log aggregation
- [ ] Enable security headers on reverse proxy
- [ ] Configure rate limiting
- [ ] Set up health checks and auto-recovery
- [ ] Document runbooks for common issues

---

## Security Architecture

### Authentication & Authorization

#### API Keys
- **Purpose**: Service-to-service and third-party API authentication
- **Method**: `x-api-key` header, or `Authorization: Bearer` / `ApiKey` header. Query-string keys are not accepted.
- **Scopes**: a plain string key is full access; an object key `{ key, name, scopes }` reaches only those permissions
- **Anonymous callers**: when keys are required, a declared non-public route refuses a caller with no identity (`401 MISSING_API_KEY`)
- **Storage**: environment variables or settings (never in code)
- **Rotation**: recommended quarterly; `nooblyjs keys generate` prints a new key

#### Personal Access Tokens
- **Purpose**: Scripts and coding agents acting for one user
- **Method**: `dtk_` token sent as a Bearer header; it opens `/services/*/api` only when its owner is an admin
- **Scopes**: a token may be narrowed to fewer permissions than its owner holds; it cannot be wider

#### Session Authentication
- **Purpose**: Dashboard sign-in
- **Method**: httpOnly, SameSite=Strict session cookie. Nothing that grants access is kept in the browser.
- **Idle timeout**: 30 minutes for admin sessions, 8 hours for other users (`sessionIdleTimeoutMs` overrides)
- **Absolute TTL**: the cookie's max age, 24 hours by default
- **Storage**: a pruning in-process store, or Redis when `SESSION_REDIS_URL` or `REDIS_URL` is set
- **Invalidation**: logout, idle timeout, or a password change

#### Cross-Site Requests
- **Check**: state-changing requests that carry only the session cookie are refused (`403 CSRF_ORIGIN_MISMATCH`) when their `Origin` or `Referer` is another site
- **Trusted origins**: `security.csrf.allowedOrigins` and `CORS_ORIGINS`
- **Opt-out**: `security.csrf.enabled: false`

#### Route Permissions (RBAC)
- **Declaration**: every `/services/*/api` route declares a permission (`service:action`) in `src/authservice/config/routePermissions.js`
- **Roles**: `admin` (everything), `editor` (read and write to filing, searching, dataservice, caching, queueing, knowledge; read logging and measuring), `user` (read filing and searching, own profile, evaluate flags)
- **Strict mode**: on by default in production; a route with no declaration is refused and start-up fails
- **Verification**: the authorization matrix is generated from the declarations and runs on every pull request

#### Invitations
- **Purpose**: Account creation without open sign-up
- **Controls**: invitation codes are hashed at rest; an approved invitation has an expiry; a code is revoked after five failed redeems; codes can be delivered by email when `SMTP_URL` is set

#### OAuth 2.0 and Sign-In Providers
- **Providers**: Google (`passport-google-oauth20`), Azure AD (`passport-azure-ad`), secure email, and Passport local
- **Redirects**: after sign-in a person returns to a same-origin page they were heading to, then `loginSuccessRedirectUrl`, then `/services`

#### Multi-Factor Authentication
- **Status**: no built-in second factor. Sign-in through an external identity provider (Google, Azure AD) is the available route.

### Data Security

#### Encryption
- **In Transit**: HTTPS/TLS (enforced on production)
- **At Rest**: Provider-specific (MongoDB, AWS, etc.)
- **Session Keys**: Random generation with secure algorithms

#### Data Validation
- **Input Validation**: Parameter validation on all endpoints
- **SQL Injection Prevention**: Parameterized queries (database providers)
- **XSS Prevention**: Output encoding and sanitization
- **CSRF Protection**: CSRF tokens for state-changing operations

#### Sensitive Data Handling
- **API Keys**: Never logged or exposed in errors
- **Passwords**: Bcrypt hashing (authservice)
- **Tokens**: Secure generation and validation
- **PII**: Data minimization principles

### Access Control

#### Path-Based Access Control
```javascript
const options = {
  security: {
    apiKeyAuth: {
      excludePaths: [
        '/services/*/status',
        '/services/authservice/api/login',
        '/services/authservice/api/register'
      ]
    }
  }
};
```

#### Role-Based Access Control (RBAC)
- **Implementation**: Via AuthService providers. Roles grant permissions (`ROLE_PERMISSIONS`): `admin` (everything), `editor` (filing, searching, dataservice, caching, queueing) and `user` (filing and searching read, own profile)
- **Permissions**: `service:action` per route. Every `/services/*/api` route declares one (`routePermissions.js`); strictAuth refuses undeclared routes and fails start-up in production
- **Scoped credentials**: API keys can carry scopes; personal access tokens can be narrowed to a subset of their owner's permissions

#### Service-Level Authentication
- **Optional**: Require authentication for all service endpoints
- **Configuration**: `requireLogin: true` in options

### Security Best Practices

1. **Principle of Least Privilege**: Services only have access to required dependencies
2. **Defense in Depth**: Multiple security layers (API key + session + RBAC)
3. **Security Headers**: Configure on reverse proxy
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `X-XSS-Protection: 1; mode=block`
   - `Strict-Transport-Security: max-age=31536000`
4. **Rate Limiting**: Implement on reverse proxy or use middleware
5. **Logging**: Log authentication attempts (success and failure)
6. **Monitoring**: Alert on suspicious patterns
7. **Dependency Management**: Regular security updates with `npm audit`
8. **Configuration**: Never commit secrets to repository

### Compliance & Standards

- **OWASP Top 10**: Addresses injection, XSS, CSRF, broken auth
- **NIST Guidelines**: Following secure development practices
- **GDPR Ready**: Supports data deletion and consent management
- **Audit Logging**: Available through logging service

---

## Testing & Quality Assurance

### Test Organization

```
tests/
├── unit/                    # 18 service unit tests + middleware
├── api/                     # HTTP API integration tests
├── load/                    # Performance/stress tests
└── activities/              # Example activity tests
```

### Unit Testing

**Framework**: Jest 30.0.3

**Pattern**:
```javascript
describe('Service Name', () => {
  let service;
  let mockEventEmitter;

  beforeEach(() => {
    mockEventEmitter = new EventEmitter();
    jest.spyOn(mockEventEmitter, 'emit');

    service = createService('provider-type', {
      dependencies: { logging: mockLogger }
    }, mockEventEmitter);
  });

  it('should perform operation', async () => {
    const result = await service.operation();
    expect(result).toBeDefined();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'event:name',
      expect.any(Object)
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
```

**Coverage Targets**:
- Unit tests: >90% coverage per service
- Integration tests: Critical paths
- Load tests: Performance baselines

### Integration Testing

**Tool**: Supertest + Nock (HTTP mocking)

**Scope**:
- HTTP API endpoints
- Service-to-service communication
- Database operations
- Queue operations

### Load Testing

**Scenarios**:
- **Quick**: 100 iterations for rapid feedback
- **Standard**: 500 iterations for validation
- **Stress**: 2000 iterations for limits
- **Soak**: 10000 iterations for stability

**Coverage**: All services with realistic payloads

### Test Commands

```bash
# Run all tests
npm test

# Run specific service tests
npm test -- tests/unit/caching/cache.test.js

# Watch mode for development
npm test -- --watch

# Coverage report
npm test -- --coverage

# Load tests
npm run test-load
```

### Quality Gates

- **Code Coverage**: >85% across codebase
- **Test Pass Rate**: 100% required
- **Type Checking**: ESLint validation
- **Security**: npm audit with no critical vulnerabilities
- **Performance**: Load tests within baseline

### Disabled Tests

Tests requiring external services (not in CI/CD):
- Redis tests (requires Redis instance)
- Memcached tests (requires Memcached)
- MongoDB tests (requires MongoDB instance)
- Filing tests (requires FTP/Git setup)
- S3 tests (requires AWS credentials)

---

## Monitoring & Observability

### Metrics Collection

**Built-in Metrics**:
- Request count and latency
- Cache hit/miss rates
- Queue depth and processing time
- Database operation latency
- Error rates and types
- Service availability/uptime

### Monitoring Endpoints

```
GET /services/api/monitoring/metrics
GET /services/api/monitoring/snapshot
```

### Custom Metrics

```javascript
const measuring = registry.measuring();

// Record custom metrics
measuring.record('custom.metric', 100, {
  tag1: 'value1',
  tag2: 'value2'
});

// Retrieve metrics
const metrics = measuring.getMetrics('custom.metric');
const stats = measuring.getStats('custom.metric');
```

### Logging Strategy

**Log Levels**:
- **DEBUG**: Development information
- **INFO**: General informational messages
- **WARN**: Warning conditions
- **ERROR**: Error conditions

**Structured Logging**:
```javascript
logger.info('User login', {
  userId: user.id,
  email: user.email,
  timestamp: new Date(),
  ip: req.ip
});
```

### Event Monitoring

**Key Events**:
- Service lifecycle (created, destroyed)
- Cache operations (hit, miss, set, delete)
- Queue operations (push, pop)
- Database operations (create, update, delete)
- Workflow execution (started, completed, failed)
- Authentication events (login, logout, failed auth)

### Alerting

**Recommended Alerts**:
- Error rate > 1% in 5-minute window
- Cache hit rate < 80%
- Queue backlog > 10,000 messages
- Database response time > 1000ms
- Service unavailable (health check failed)
- Authentication failures > 10/minute from same IP

### Dashboard & Visualization

**Recommended Tools**:
- Grafana (metrics visualization)
- Kibana (log aggregation)
- Prometheus (metrics collection)
- ELK Stack (centralized logging)

---

## Roadmap & Future Enhancements

The full plan, with what is still open, is in [Roadmap.md](Roadmap.md). Each feature's spec under `features/` records its status and evidence.

### Delivered (2026-11-12 to 2026-11-16)

| Area | What shipped |
|------|--------------|
| Security | Filing authorization and locked settings; invitation hardening; code-execution boundary for activities; safe content serving and strict CSP for script handlers; route-level RBAC with scoped keys; session and token hygiene; authorization matrix, ZAP baseline and secret scanning in CI; nightly dependency audit |
| AI | AI Service v2 on the shared module (complete, stream, tools, embeddings) for six providers; semantic search; knowledge service with cited answers, streaming, feedback and evaluation |
| Platform | Reliable jobs (retries, dead-letter queue) on memory and Redis; TypeScript types and validated config; Express 5; dual CommonJS and ESM entry points; Node 22 |
| Developer experience | MCP server; OpenAPI 3.1 document and generated typed client; `nooblyjs` CLI (`create`, `add`, `doctor`, `routes`, `openapi`, `keys`, `mcp`); test kit and provider contract suites |
| Operations | OpenTelemetry tracing; webhooks with signed delivery and a scheduled relay; MongoDB transactional outbox; feature flags with an OpenFeature provider; workflow state snapshot and restore |

### Still open

- **Horizontal scaling:** shared lockouts, invitations, cron and interval claims, and the workflow snapshot are in place. A two-replica test needs a database-backed auth provider.
- **Agentic workflows:** AI, agent, approval and branch steps with durable state. Not started.
- **Reliable jobs on other queue providers:** RabbitMQ, ActiveMQ, AWS, Azure, GCP and the API proxy refuse reliable options with a clear error.
- **Live-provider checks:** semantic search and knowledge answers have not been evaluated against a real embedding provider or a real model.
- **Release 2.0.0 (shipped):** removal of the legacy AI providers (`claude`, `openai`, `ollama`, `gemini`), strict CSP without `'unsafe-inline'` for styles, and typings for the named ESM exports.

### Future providers

Providers are added through the provider pattern (`npx nooblyjs add provider`). Candidates are a Valkey cache, further object stores and a managed vector database. Each new provider must pass its service's contract suite before it is listed as supported.

---

## Conclusion

NooblyJS Core represents a mature, production-ready framework for building scalable microservices platforms. With its comprehensive service catalog, flexible provider architecture, and enterprise features, it enables teams to build sophisticated applications faster while maintaining code quality and system reliability.

The framework's event-driven, dependency-injected design makes it suitable for:
- Small startups building MVPs
- Enterprise teams managing complex microservices
- AI-powered applications leveraging modern LLMs
- Multi-cloud and hybrid cloud deployments
- Teams requiring rapid feature development

**Key Success Factors**:
1. Leverage multi-provider flexibility for vendor independence
2. Use event-driven patterns for loose coupling
3. Implement comprehensive monitoring and logging
4. Follow security best practices from day one
5. Plan for horizontal scaling with external infrastructure
6. Invest in infrastructure-as-code and automation

---

## Appendices

### A. Common Use Cases & Solutions

#### Use Case 1: SaaS Platform with Multi-Tenancy

**Services**: AuthService, DataService, Caching, Searching, AIService
**Provider Stack**:
- Auth: MongoDB per tenant
- Cache: Redis with key prefixes
- Data: DocumentDB or MongoDB Atlas
- Search: Elasticsearch or built-in file search

#### Use Case 2: Content Management System

**Services**: Filing, DataService, Searching, Workflow, Notifying
**Provider Stack**:
- Filing: S3 for media, local for dev
- Data: MongoDB for documents
- Search: Elasticsearch for indexing
- Workflow: Publish/approval workflows

#### Use Case 3: Real-Time Analytics Platform

**Services**: Queueing, DataService, Measuring, Working, AIService
**Provider Stack**:
- Queue: Kafka for event streaming
- Data: TimescaleDB or ClickHouse
- Measuring: Custom metrics on Prometheus
- Workers: Processing pipeline for ETL

#### Use Case 4: AI-Powered Assistant

**Services**: AIService, Queueing, DataService, Caching, Workflow
**Provider Stack**:
- AI: Multiple model support (Claude, GPT-4, Ollama)
- Queue: Redis for task distribution
- Data: Vector DB for embeddings, MongoDB for conversations
- Cache: Redis for frequent responses
- Workflow: Multi-step AI reasoning chains

### B. Migration Guide

**From Monolith to Microservices**:
1. Extract AuthService to separate instance
2. Extract DataService with external database
3. Introduce Queueing for async operations
4. Add Caching for performance
5. Extract business logic to Workflow service
6. Migrate remaining endpoints to specific services

### C. Troubleshooting Guide

| Issue | Cause | Solution |
|-------|-------|----------|
| Circular dependency error | Service A depends on B, B depends on A | Refactor to share infrastructure service |
| High memory usage | In-memory provider leaking | Switch to Redis, add TTL cleanup |
| Slow queries | No database indexes | Add appropriate indexes, use caching |
| Queue backlog | Processing slower than ingestion | Add workers, optimize processing step |
| Auth failures | Invalid API key | Verify key in config, check excludePaths |

### D. Performance Tuning

**Caching Strategy**:
- Cache responses for 1-5 minutes by default
- Cache user data for 30 minutes
- Cache system config for 1 hour
- Use Redis for distributed cache in production

**Database Optimization**:
- Create indexes on frequently queried fields
- Use pagination for large result sets
- Implement materialized views for complex queries

**Queue Tuning**:
- Adjust worker count based on CPU utilization
- Implement batch processing for bulk operations
- Use priority queues for time-sensitive tasks

---

**Document End**

This PRD provides a comprehensive overview of NooblyJS Core, suitable for stakeholders, developers, and architects. For implementation details, refer to the CLAUDE.md file and service-specific documentation.
