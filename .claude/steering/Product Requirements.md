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

**NooblyJS Core** is an enterprise-grade, modular Node.js backend framework providing a comprehensive microservices platform with 16+ independently deployable services. Built on proven design patterns (Singleton, Factory, Dependency Injection), it enables rapid development of scalable, cloud-native applications with built-in support for authentication, caching, data persistence, AI integration, and workflow orchestration.

### Key Value Propositions

- **Time-to-Market**: Pre-built services eliminate boilerplate; focus on business logic
- **Scalability**: Multi-cloud support (AWS, Azure, GCP) with horizontal scaling
- **Flexibility**: 52+ provider implementations across services for diverse backend needs
- **Enterprise-Ready**: Built-in authentication, authorization, monitoring, analytics
- **Developer Experience**: Automatic dependency injection, event-driven communication, comprehensive REST APIs
- **AI-Integrated**: Native support for Claude, OpenAI, and Ollama models
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

**Performance Characteristics**:
- Memory: <1ms latency
- Redis: 1-5ms latency
- Memcached: 1-5ms latency
- File: 5-50ms latency

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
- `push(queueName, message)` - Enqueue message
- `pop(queueName)` - Dequeue message
- `peek(queueName, count)` - View messages without removing
- `getStatus(queueName)` - Queue statistics
- `purge(queueName)` - Clear queue

**Performance Characteristics**:
- Memory: <1ms push/pop
- Redis: 5-10ms push/pop
- RabbitMQ: 10-20ms push/pop
- AWS SQS: 50-100ms push/pop

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
Multi-channel notification delivery system.

**Purpose**: Centralize notification management across multiple channels

**Providers Available** (2):
1. **Memory** - In-process notification queue
2. **API** - Remote notification service

**Core Capabilities**:
- Topic-based pub/sub messaging
- Notification queuing and delivery
- Subscriber management
- Delivery tracking
- Topic filtering

**Key Methods**:
- `publish(topic, message)` - Publish notification
- `subscribe(topic, handler)` - Subscribe to topic
- `unsubscribe(topic, handler)` - Unsubscribe
- `getSubscribers(topic)` - List subscribers

**Dependencies**: Logging

**Use Cases**:
- User notifications
- System alerts
- Event notifications
- Webhooks
- Email/SMS delivery coordination

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

**Performance Considerations**:
- Memory: Fastest (in-process)
- File: Good for small datasets
- MongoDB: Best for large datasets and complex queries
- DocumentDB: AWS-integrated, auto-scaling
- SimpleDB: Simple key-value access

**Dependencies**: Logging, Queueing

**Use Cases**:
- User data storage
- Application configuration
- Session data
- Audit logs
- Business entity storage

---

#### **Working Service** (`src/working/`)
Worker thread and activity execution engine.

**Purpose**: Execute long-running tasks asynchronously without blocking requests

**Capabilities**:
- Activity execution from files
- Worker script management
- Task queuing and scheduling
- Error handling and recovery
- Result capture and storage
- Worker lifecycle management

**Key Methods**:
- `executeActivity(activityPath, input)` - Run activity
- `executeWorker(workerScript, data)` - Execute worker
- `getStatus(workerId)` - Get execution status
- `getResult(workerId)` - Get execution result

**Activity Structure**:
```javascript
module.exports = async (input, context) => {
  // Process input
  // Access context.logging, context.cache, etc.
  return result;
};
```

**Dependencies**: Logging, Queueing, Caching

**Use Cases**:
- Background job processing
- Long-running computations
- Data transformations
- Report generation
- File processing

---

#### **Measuring Service** (`src/measuring/`)
Metrics collection and performance analysis.

**Purpose**: Collect, aggregate, and analyze application performance metrics

**Capabilities**:
- Custom metric recording
- Time-series data collection
- Aggregation and statistics
- Performance tracking
- Metric querying

**Key Methods**:
- `record(metricName, value, tags)` - Record metric
- `getMetrics(name)` - Retrieve metrics
- `getStats(name)` - Get aggregated stats
- `clear(name)` - Clear metrics

**Metric Types**:
- Counters (request counts, errors)
- Gauges (memory usage, connections)
- Histograms (response times, sizes)
- Timers (operation duration)

**Dependencies**: Logging, Queueing, Caching

**Use Cases**:
- Request/response metrics
- Performance monitoring
- Error rate tracking
- Custom business metrics
- SLA tracking

---

### Level 3: Application Services

#### **Scheduling Service** (`src/scheduling/`)
Task scheduling and cron job management.

**Purpose**: Execute tasks on defined schedules with reliability and monitoring

**Capabilities**:
- One-time task scheduling
- Recurring task scheduling (cron expressions)
- Timezone support
- Task execution history
- Failure handling and retry
- Task cancellation

**Key Methods**:
- `scheduleOnce(jobName, scheduledTime, handler)` - Schedule once
- `scheduleCron(jobName, cronExpression, handler)` - Recurring schedule
- `cancel(jobName)` - Cancel job
- `getStatus(jobName)` - Get job status
- `getHistory(jobName)` - Get execution history

**Supported Cron Formats**:
```
* * * * * * (second minute hour day month dayOfWeek)
0 */5 * * * * (Every 5 minutes)
0 0 * * * * (Every day at midnight)
0 0 0 * * 0 (Every Sunday at midnight)
```

**Dependencies**: Logging, Working

**Use Cases**:
- Data cleanup tasks
- Report generation on schedule
- Cache warming
- Periodic health checks
- Backup scheduling

---

#### **Searching Service** (`src/searching/`)
Full-text search with result caching and intelligent indexing.

**Purpose**: Provide fast, flexible search capabilities across large datasets

**Capabilities**:
- Full-text search
- Keyword filtering
- Result ranking and sorting
- Pagination support
- Search result caching
- Faceted search
- Custom search filters

**Key Methods**:
- `search(query, filters, options)` - Execute search
- `index(data)` - Index data for searching
- `reindex()` - Rebuild search index
- `getStats()` - Get search statistics

**Search Features**:
- Prefix matching
- Boolean operators (AND, OR, NOT)
- Phrase search
- Wildcard support
- Fuzzy matching (provider dependent)

**Performance**:
- Cached results: <10ms
- Index search: <100ms for large datasets
- Full reindex: Variable based on dataset size

**Dependencies**: Logging. The registry injects no other service. Caching, DataService, Queueing, Working and Scheduling are optional collaborators that an application wires in itself.

**Use Cases**:
- Product catalog search
- Document search
- User directory search
- Knowledge base search
- Log search and analysis

---

#### **Workflow Service** (`src/workflow/`)
Complex multi-step workflow orchestration engine.

**Purpose**: Define and execute multi-step workflows with error handling and state management

**Capabilities**:
- Step-by-step workflow execution
- Sequential and conditional execution
- Input/output chaining between steps
- Error handling and recovery
- Timeout management
- State persistence
- Progress tracking

**Key Methods**:
- `defineWorkflow(name, steps)` - Define workflow
- `execute(workflowName, input)` - Execute workflow
- `getStatus(executionId)` - Get execution status
- `cancel(executionId)` - Cancel execution

**Step Format**:
```javascript
module.exports = async (input, context) => {
  // Input: output from previous step
  // context: { logging, dataservice, cache, ... }
  return output; // Feeds to next step
};
```

**Workflow Definition**:
```javascript
const workflow = [
  './steps/fetch-data.js',
  './steps/transform-data.js',
  './steps/validate-data.js',
  './steps/store-data.js'
];
```

**Error Handling**:
- Step-level try/catch
- Fallback steps
- Retry logic
- Error callback steps

**Dependencies**: Logging, Queueing, Scheduling, Measuring, Working

**Use Cases**:
- Data pipeline orchestration
- ETL (Extract, Transform, Load) processes
- Multi-service workflows
- Long-running business processes
- Approval workflows

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
- `register(userData)` - Register new user
- `login(email, password)` - User login
- `logout(sessionId)` - User logout
- `verifyToken(token)` - Verify JWT token
- `getUserProfile(userId)` - Get user data
- `updateProfile(userId, data)` - Update profile
- `changePassword(userId, oldPass, newPass)` - Change password

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
AI model integration and prompting service.

**Purpose**: Provide unified interface to multiple AI/LLM providers

**Providers Available** (7):
1. **Claude** - Anthropic's Claude models (default for `aiservice`)
2. **OpenAI** - GPT-3, GPT-4 models (`openai`, with `chatgpt` as an alias)
3. **Ollama** - Local open-source models
4. **Gemini** - Google Gemini models
5. **OpenAI-KV** - Azure OpenAI, authenticated through Azure Key Vault
6. **TensorFlow** - Experimental progressive LSTM provider (optional `@tensorflow/tfjs-node`)
7. Shared AI module - `src/aiservice/common/` (`nooblyjs-ai-common`), one way to call every model provider including AWS Bedrock, Google Vertex AI and Azure

**Core Capabilities**:
- Text generation
- Response streaming
- Prompt management
- Model selection and switching
- Token counting
- Conversation history management
- Custom instructions/system prompts

**Key Methods**:
- `generate(prompt, options)` - Generate response
- `stream(prompt, options)` - Stream response
- `countTokens(text)` - Estimate token count
- `listModels()` - Available models
- `setModel(modelName)` - Switch model

**Supported Models**:
- Claude 3 family (Opus, Sonnet, Haiku)
- GPT-4, GPT-3.5-turbo
- Ollama local models
- Custom fine-tuned models

**Advanced Features**:
- Temperature and sampling controls
- Top-P (nucleus sampling)
- Token limits
- Custom stop sequences
- Vision capabilities (where supported)

**Performance**:
- Response time: 100-5000ms depending on model/prompt
- Streaming latency: <100ms to first token
- Token processing: <1ms per token

**Dependencies**: Logging, Caching, Workflow, Queueing

**Use Cases**:
- Content generation
- Code assistance
- Customer support chatbots
- Data analysis and insights
- Summarization
- Classification and tagging
- Question answering

---

> Note: the earlier "Requesting Service" entry described a planned request router. It was never built and has been removed. Request routing is provided by Express and the per-service routes.

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
- Unit tests (Jest)
- Integration tests (HTTP API)
- Load tests (stress testing)
- Component tests

**Coverage**:
- All services have test files
- Disabled tests for external dependencies
- Load test suite for performance validation
- HTTP API test suite

**Test Utilities**:
- Mock EventEmitter
- Mock providers
- Supertest for HTTP testing
- Nock for HTTP mocking

### 9. Error Handling & Recovery

**Graceful Error Handling**: Standardized error handling across services.

**Features**:
- Error classification (validation, authentication, business logic)
- Error event broadcasting
- Error logging with context
- Recovery strategies
- Timeout handling

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

### Runtime & Web Framework
- **Node.js**: v18+ (async/await, ES6 modules)
- **Express.js**: v4.19.2 (web framework and routing)
- **Nodemon**: Development auto-reload
- **PM2**: Process management (recommended for production)

### Databases & Data Stores
| Service | Library | Version | Notes |
|---------|---------|---------|-------|
| MongoDB | mongodb | 6.19.0 | Document database |
| SimpleDB | AWS SDK | 2.1620.0 | AWS key-value store |
| DocumentDB | AWS SDK | 2.1620.0 | AWS managed MongoDB |
| Local FS | fs (native) | - | JSON file storage |

### Caching & Message Queuing
| Service | Library | Version | Notes |
|---------|---------|---------|-------|
| Redis | redis | 5.5.6 | Distributed cache/queue |
| Redis (Mock) | redis-mock | 8.9.0 | Testing |
| Memcached | memjs | 1.3.0 | High-performance cache |
| RabbitMQ | amqplib | 0.10.9 | Message broker |

### Cloud Platform SDKs
| Provider | Library | Version |
|----------|---------|---------|
| AWS | aws-sdk | 2.1620.0 |
| AWS (v3) | @aws-sdk/* | 3.614.0 |
| Azure | @azure/identity | 4.13.0 |
| Google Cloud | @google-cloud/storage | 7.17.0 |

### AI & LLM Integration
| Provider | Library | Version |
|----------|---------|---------|
| Anthropic Claude | @anthropic-ai/sdk | 0.60.0 |
| OpenAI | openai | 5.23.2 |
| Google Gemini | @google/gemini-cli | 0.1.22 |

### Authentication & Authorization
| Component | Library | Version | Purpose |
|-----------|---------|---------|---------|
| Passport | passport | 0.7.0 | Auth framework |
| OAuth | passport-google-oauth20 | 2.0.0 | Google OAuth |
| Local | passport-local | 1.0.0 | Username/password |
| Sessions | express-session | 1.17.3 | Session management |

### Utilities & Tools
| Component | Library | Version |
|-----------|---------|---------|
| UUID | uuid | 11.1.0 |
| File Upload | multer | 2.0.2 |
| Git Ops | simple-git | 3.28.0 |
| FTP | ftp | 0.3.10 |
| HTTP Client | axios | 1.7.7 |
| Environment | dotenv | 17.2.1 |

### Testing & Quality
| Tool | Library | Version |
|------|---------|---------|
| Test Framework | jest | 30.0.3 |
| HTTP Mocking | nock | 13.5.6 |
| HTTP Testing | supertest | 7.1.4 |
| Request Handling | body-parser | 1.20.2 |

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

#### API Key Authentication
- **Purpose**: Service-to-service and third-party API authentication
- **Method**: Bearer token in Authorization header
- **Validation**: On every request to protected endpoints
- **Storage**: Environment variables (never in code)
- **Rotation**: Recommended quarterly

#### Session Authentication
- **Purpose**: User login sessions
- **Method**: HTTPOnly secure cookies
- **Duration**: Configurable TTL (default 24 hours)
- **Storage**: Configurable (memory, Redis, database)
- **Invalidation**: Logout or timeout

#### OAuth 2.0
- **Purpose**: Third-party identity provider integration
- **Providers**: Google OAuth 2.0 ready
- **Flow**: Authorization code flow with PKCE support
- **Scopes**: Configurable per provider

#### Multi-Factor Authentication (Future)
- **Planned**: TOTP support
- **Implementation**: In AuthService providers

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

### Phase 1: Core Platform (Current)
- ✓ Service registry and dependency injection
- ✓ 16+ modular services
- ✓ Multi-provider architecture
- ✓ Event-driven communication
- ✓ REST API auto-generation

### Phase 2: Enterprise Features (Q1-Q2 2026)
- [ ] Role-based access control (RBAC) improvements
- [ ] Multi-factor authentication (TOTP)
- [ ] GraphQL API support
- [ ] Webhook management service
- [ ] API gateway integration
- [ ] Service mesh compatibility (Istio)

### Phase 3: AI/ML Enhancement (Q2-Q3 2026)
- [ ] Fine-tuning model support
- [ ] Embedding service for similarity search
- [ ] Vector database integration (Pinecone, Weaviate)
- [ ] RAG (Retrieval Augmented Generation) service
- [ ] Model training pipeline service

### Phase 4: Analytics & Insights (Q3-Q4 2026)
- [ ] Advanced analytics service
- [ ] Real-time dashboarding
- [ ] Anomaly detection
- [ ] Predictive analytics
- [ ] Custom report builder

### Phase 5: Developer Experience (Q4 2026-Q1 2027)
- [ ] CLI tool for scaffolding
- [ ] VSCode extension
- [ ] API documentation generator
- [ ] Test generation tools
- [ ] Performance profiler

### Phase 6: Advanced Capabilities (2027)
- [ ] Service mesh integration (Kubernetes-native)
- [ ] Distributed tracing (OpenTelemetry)
- [ ] Advanced security (mTLS, secrets management)
- [ ] Multi-region deployment
- [ ] Edge computing support

### Future Providers

**Caching**:
- DynamoDB
- Elasticache
- Hazelcast

**DataService**:
- PostgreSQL
- MySQL
- CockroachDB
- Cassandra

**Queueing**:
- Kafka
- Apache Pulsar
- AWS EventBridge

**AIService**:
- LLaMA
- Mistral
- Local embeddings

**Filing**:
- Azure Blob Storage
- MinIO
- Backblaze B2

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
