# NooblyJS Core - Technical Usage Guide

## Overview

This comprehensive guide covers all aspects of using the NooblyJS Core framework, from basic setup to advanced configurations. Whether you're building APIs, web applications, or microservices, this guide provides practical examples and patterns for leveraging all framework capabilities.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Service Registry Architecture](#service-registry-architecture)
3. [API Usage](#api-usage)
4. [Programmatic Usage](#programmatic-usage)
5. [Web Interface](#web-interface)
6. [Authentication & Security](#authentication--security)
7. [Service Reference](#service-reference)
8. [Configuration](#configuration)
9. [Deployment](#deployment)
10. [Testing](#testing)
11. [Best Practices](#best-practices)
12. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Installation

```bash
# Install from npm
npm install noobly-core

# Clone and run locally
git clone https://github.com/StephenBooysen/nooblyjs-core.git
cd nooblyjs-core
npm install
```

### Quick Start - Basic Usage

```javascript
const express = require('express');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());

// Initialize the service registry
serviceRegistry.initialize(app);

// Get services
const cache = serviceRegistry.cache('memory');
const logger = serviceRegistry.logger('console');
const dataServe = serviceRegistry.dataServe('memory');

// Use services programmatically
await cache.put('user:123', { name: 'John', email: 'john@example.com' });
const user = await cache.get('user:123');
logger.info('Retrieved user:', user);

app.listen(3000, () => {
  logger.info('Server running on port 3000');
});
```

### Quick Start - With API Keys

```javascript
const express = require('express');
const serviceRegistry = require('noobly-core');

const app = express();
app.use(express.json());

// Generate API keys
const apiKey = serviceRegistry.generateApiKey();
console.log('Generated API Key:', apiKey);

// Initialize with security
serviceRegistry.initialize(app, {
  apiKeys: [apiKey],
  requireApiKey: true,
  excludePaths: [
    '/services/*/status',
    '/services/',
    '/services/*/views/*'
  ]
});

app.listen(3000);
```

---

## Service Registry Architecture

### Core Concepts

The NooblyJS Core implements a **Service Registry Pattern** with the following principles:

- **Singleton Pattern**: One instance per service type/provider combination
- **Provider Pattern**: Multiple backend implementations for each service
- **Event-Driven**: Global EventEmitter for inter-service communication
- **RESTful APIs**: Consistent HTTP endpoints for all services

### Service Lifecycle

```javascript
// 1. Initialize registry (once)
serviceRegistry.initialize(app, eventEmitter, options);

// 2. Get service instances (cached as singletons)
const cache = serviceRegistry.cache('redis', { host: 'localhost', port: 6379 });

// 3. Use services
await cache.put('key', 'value');

// 4. Services are automatically configured with routes and middleware
```

### Available Services

| Service | Purpose | Providers | API Endpoints |
|---------|---------|-----------|---------------|
| **caching** | High-performance caching | memory, redis, memcached | `/services/caching/api/*` |
| **dataserve** | Persistent data storage | memory, simpledb, file | `/services/dataserve/api/*` |
| **filing** | File management | local, ftp, s3, git, sync | `/services/filing/api/*` |
| **logging** | Application logging | console, file | `/services/logging/api/*` |
| **measuring** | Metrics collection | memory | `/services/measuring/api/*` |
| **notifying** | Pub/sub messaging | memory | `/services/notifying/api/*` |
| **queueing** | Task queueing | memory | `/services/queueing/api/*` |
| **scheduling** | Task scheduling | memory | `/services/scheduling/api/*` |
| **searching** | Full-text search | memory | `/services/searching/api/*` |
| **workflow** | Multi-step workflows | memory | `/services/workflow/api/*` |
| **working** | Background tasks | memory | `/services/working/api/*` |

---

## API Usage

### Authentication Methods

API endpoints support multiple authentication methods:

```bash
# Method 1: x-api-key header
curl -H "x-api-key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'

# Method 2: Authorization Bearer
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'

# Method 3: Authorization ApiKey
curl -H "Authorization: ApiKey YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'

# Method 4: Query parameter
curl -H "Content-Type: application/json" \
     -X POST "http://localhost:3000/services/caching/api/put/mykey?api_key=YOUR_API_KEY" \
     -d '{"value": "Hello World"}'

# Method 5: api-key header
curl -H "api-key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3000/services/caching/api/put/mykey \
     -d '{"value": "Hello World"}'
```

### Caching API

```bash
# Store data
POST /services/caching/api/put/user:123
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "userId": "123",
  "name": "John Doe",
  "email": "john@example.com",
  "preferences": {
    "theme": "dark",
    "notifications": true
  }
}

# Retrieve data
GET /services/caching/api/get/user:123
x-api-key: YOUR_API_KEY

# Response:
{
  "userId": "123",
  "name": "John Doe",
  "email": "john@example.com",
  "preferences": {
    "theme": "dark",
    "notifications": true
  }
}

# Delete data
DELETE /services/caching/api/delete/user:123
x-api-key: YOUR_API_KEY

# Get cache analytics
GET /services/caching/api/list
x-api-key: YOUR_API_KEY

# Response:
{
  "success": true,
  "data": [
    {
      "key": "user:123",
      "hitCount": 5,
      "lastAccessed": "2025-08-25T10:30:00Z"
    }
  ],
  "total": 1
}

# Check service status (no auth required)
GET /services/caching/api/status

# Response: "caching api running"
```

### DataServe API

```bash
# Store persistent data
POST /services/dataserve/api/put/config:app
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "appConfig": {
    "version": "1.2.0",
    "features": ["caching", "logging", "metrics"],
    "environment": "production"
  },
  "updatedAt": "2025-08-25T10:30:00Z"
}

# Retrieve persistent data
GET /services/dataserve/api/get/config:app
x-api-key: YOUR_API_KEY

# Delete persistent data
DELETE /services/dataserve/api/delete/config:app
x-api-key: YOUR_API_KEY
```

### Filing API

```bash
# Upload file
POST /services/filing/api/upload/documents/report.pdf
Content-Type: multipart/form-data
x-api-key: YOUR_API_KEY

[Binary file data]

# Download file
GET /services/filing/api/download/documents/report.pdf
x-api-key: YOUR_API_KEY

# Delete file
DELETE /services/filing/api/remove/documents/report.pdf
x-api-key: YOUR_API_KEY
```

### Workflow API

```bash
# Define a workflow
POST /services/workflow/api/defineworkflow
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "name": "userOnboarding",
  "steps": [
    "/path/to/steps/validateUser.js",
    "/path/to/steps/sendWelcomeEmail.js",
    "/path/to/steps/setupAccount.js"
  ]
}

# Start workflow execution
POST /services/workflow/api/start
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "name": "userOnboarding",
  "data": {
    "userId": "123",
    "email": "new-user@example.com",
    "signupSource": "website"
  }
}
```

### Queue API

```bash
# Add task to queue
POST /services/queueing/api/enqueue
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "taskType": "sendEmail",
  "recipient": "user@example.com",
  "template": "welcome",
  "priority": "high"
}

# Get next task from queue
GET /services/queueing/api/dequeue
x-api-key: YOUR_API_KEY

# Check queue size
GET /services/queueing/api/size
x-api-key: YOUR_API_KEY
```

### Error Responses

All APIs return consistent error responses:

```json
{
  "error": "Unauthorized",
  "message": "API key is required. Provide it via x-api-key header, Authorization header, or api_key query parameter.",
  "code": "MISSING_API_KEY"
}
```

```json
{
  "error": "Not Found",
  "message": "Key 'nonexistent-key' not found",
  "code": "KEY_NOT_FOUND"
}
```

---

## Programmatic Usage

### Service Configuration Patterns

```javascript
// Memory-based services (development/testing)
const cache = serviceRegistry.cache('memory');
const dataServe = serviceRegistry.dataServe('memory');
const logger = serviceRegistry.logger('console');

// Production services with external providers
const cache = serviceRegistry.cache('redis', {
  host: 'redis.example.com',
  port: 6379,
  password: 'your-redis-password',
  keyPrefix: 'myapp:'
});

const dataServe = serviceRegistry.dataServe('simpledb', {
  domain: 'myapp-data',
  region: 'us-east-1'
});

const logger = serviceRegistry.logger('file', {
  filename: '/var/log/myapp.log',
  maxFiles: 5,
  maxSize: '10m'
});

const filing = serviceRegistry.filing('s3', {
  bucket: 'myapp-files',
  region: 'us-west-2',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
```

### Advanced Service Usage

#### Caching with Analytics

```javascript
const cache = serviceRegistry.cache('redis', {
  host: 'localhost',
  port: 6379,
  enableAnalytics: true
});

// Store with TTL
await cache.put('session:abc123', userData, 3600); // 1 hour TTL

// Retrieve with analytics
const userData = await cache.get('session:abc123');

// Get cache performance metrics
const analytics = cache.getAnalytics();
console.log('Cache hit ratio:', analytics.hitRatio);
console.log('Most accessed keys:', analytics.topKeys);
```

#### File Management

```javascript
const filing = serviceRegistry.filing('local', {
  baseDir: '/app/uploads'
});

// Upload file from stream
const fileStream = fs.createReadStream('./document.pdf');
await filing.create('documents/report.pdf', fileStream);

// Download file to stream
const downloadStream = await filing.read('documents/report.pdf');

// File operations
const exists = await filing.exists('documents/report.pdf');
const metadata = await filing.getMetadata('documents/report.pdf');
await filing.delete('documents/report.pdf');
```

#### Workflow Orchestration

```javascript
const workflow = serviceRegistry.workflow('memory');

// Define workflow steps
const steps = [
  path.resolve(__dirname, './steps/validateInput.js'),
  path.resolve(__dirname, './steps/processData.js'),
  path.resolve(__dirname, './steps/saveResults.js'),
  path.resolve(__dirname, './steps/sendNotification.js')
];

await workflow.defineWorkflow('dataProcessing', steps);

// Execute workflow with callback
workflow.runWorkflow('dataProcessing', { 
  inputData: rawData,
  userId: '123'
}, (result) => {
  console.log('Workflow completed:', result);
});
```

#### Pub/Sub Messaging

```javascript
const notifying = serviceRegistry.notifying('memory');

// Create topic and subscribers
notifying.createTopic('user-events');

notifying.subscribe('user-events', (message) => {
  console.log('User event:', message);
  // Handle user registration, login, etc.
});

notifying.subscribe('user-events', (message) => {
  // Analytics service subscriber
  analyticsService.track(message);
});

// Publish events
notifying.notify('user-events', {
  type: 'user-registered',
  userId: '123',
  timestamp: new Date().toISOString()
});
```

#### Background Task Processing

```javascript
const worker = serviceRegistry.working('memory');
const queue = serviceRegistry.queue('memory');

// Add tasks to queue
queue.enqueue({
  type: 'sendEmail',
  recipient: 'user@example.com',
  template: 'welcome'
});

queue.enqueue({
  type: 'generateReport',
  reportId: '456',
  format: 'pdf'
});

// Start worker to process tasks
worker.start('./workers/taskProcessor.js', (result) => {
  console.log('Task completed:', result);
});
```

#### Metrics Collection

```javascript
const measuring = serviceRegistry.measuring('memory');

// Record metrics
measuring.add('api.response.time', 145); // milliseconds
measuring.add('api.request.count', 1);
measuring.add('memory.usage', process.memoryUsage().heapUsed);

// Query metrics
const responseTimeMetrics = measuring.list(
  'api.response.time',
  new Date('2025-08-25T00:00:00Z'),
  new Date('2025-08-25T23:59:59Z')
);

const totalRequests = measuring.total(
  'api.request.count',
  startDate,
  endDate
);

console.log('Average response time:', 
  measuring.average('api.response.time', startDate, endDate));
```

### Event-Driven Architecture

```javascript
// Get global event emitter
const eventEmitter = serviceRegistry.getEventEmitter();

// Listen for service events
eventEmitter.on('cache-hit', (data) => {
  console.log('Cache hit:', data);
});

eventEmitter.on('cache-miss', (data) => {
  console.log('Cache miss:', data);
  // Maybe log for analytics
});

eventEmitter.on('api-auth-failure', (data) => {
  console.log('Security alert:', data);
  // Send alert to monitoring system
});

eventEmitter.on('workflow-completed', (data) => {
  console.log('Workflow finished:', data);
  // Trigger next business process
});

// Emit custom events
eventEmitter.emit('business-event', { 
  type: 'order-placed',
  orderId: '789'
});
```

---

## Web Interface

### Service Registry Dashboard

Navigate to `http://localhost:3000/services/` to access the main service registry dashboard. This provides:

- **Service status overview**
- **Interactive API testing**
- **Real-time metrics**
- **Configuration management**

### Individual Service Interfaces

Each service provides its own web interface:

```
http://localhost:3000/services/caching/views/     # Caching service UI
http://localhost:3000/services/dataserve/views/   # Data service UI  
http://localhost:3000/services/filing/views/      # File management UI
http://localhost:3000/services/workflow/views/    # Workflow designer
```

### UI Theme Options

The framework includes multiple UI themes:

```javascript
// In your HTML or routing
app.use('/theme-glass', express.static(path.join(__dirname, 'themes/glass')));
app.use('/theme-flat', express.static(path.join(__dirname, 'themes/flat')));
app.use('/theme-material', express.static(path.join(__dirname, 'themes/material')));
app.use('/theme-minimalist', express.static(path.join(__dirname, 'themes/minimalist')));
app.use('/theme-shadcn', express.static(path.join(__dirname, 'themes/shadcn')));
```

### API Testing Interface

Each service provides interactive API testing through the web interface:

1. Navigate to service-specific views
2. Use built-in forms to test API endpoints
3. View real-time responses and logs
4. Export API calls as curl commands

---

## Authentication & Security

### API Key Management

```javascript
// Generate secure API keys
const apiKey = serviceRegistry.generateApiKey(32); // 32-character key
const shortKey = serviceRegistry.generateApiKey(16); // 16-character key

// Validate API key format
const { isValidApiKeyFormat } = require('noobly-core/src/middleware/apiKeyAuth');
console.log(isValidApiKeyFormat('abc123')); // false (too short)
console.log(isValidApiKeyFormat('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6')); // true
```

### Security Configuration

```javascript
// Strict security - all endpoints require API key
serviceRegistry.initialize(app, {
  apiKeys: ['key1', 'key2', 'key3'],
  requireApiKey: true,
  excludePaths: [] // No excluded paths
});

// Relaxed security - only sensitive endpoints require API key
serviceRegistry.initialize(app, {
  apiKeys: ['secure-key'],
  requireApiKey: true,
  excludePaths: [
    '/services/*/status',      // Health checks
    '/services/',              // Main dashboard
    '/services/*/views/*',     // Web interfaces
    '/public/*'                // Static assets
  ]
});

// Development mode - no API key required
serviceRegistry.initialize(app, {
  requireApiKey: false
});
```

### Security Event Monitoring

```javascript
const eventEmitter = serviceRegistry.getEventEmitter();

// Monitor authentication events
eventEmitter.on('api-auth-success', (data) => {
  console.log('✅ Successful auth:', {
    ip: data.ip,
    path: data.path,
    method: data.method,
    keyPrefix: data.keyPrefix
  });
});

eventEmitter.on('api-auth-failure', (data) => {
  console.log('❌ Failed auth:', {
    reason: data.reason,
    ip: data.ip,
    path: data.path,
    method: data.method
  });
  
  // Implement rate limiting, alerting, etc.
  if (data.reason === 'invalid-api-key') {
    securityService.flagSuspiciousActivity(data.ip);
  }
});

eventEmitter.on('api-auth-setup', (data) => {
  console.log('🔐 Auth configured:', data);
});
```

### Best Security Practices

1. **Rotate API Keys Regularly**
   ```javascript
   // Schedule key rotation
   setInterval(() => {
     const newKey = serviceRegistry.generateApiKey();
     // Update your configuration
   }, 30 * 24 * 60 * 60 * 1000); // 30 days
   ```

2. **Use Environment Variables**
   ```javascript
   const apiKeys = [
     process.env.API_KEY_1,
     process.env.API_KEY_2
   ].filter(Boolean);
   
   serviceRegistry.initialize(app, { apiKeys });
   ```

3. **Implement Rate Limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');
   
   app.use('/services/', rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 1000 // requests per window
   }));
   ```

---

## Service Reference

### Caching Service

**Purpose**: High-performance in-memory and distributed caching

**Providers**:
- `memory`: LRU cache with analytics
- `redis`: Distributed Redis backend  
- `memcached`: Memcached backend

**Methods**:
```javascript
await cache.put(key, value, ttl?);     // Store with optional TTL
const value = await cache.get(key);    // Retrieve
await cache.delete(key);               // Remove
const analytics = cache.getAnalytics(); // Performance data
const status = cache.status;           // Service status
```

**Configuration**:
```javascript
// Redis configuration
const cache = serviceRegistry.cache('redis', {
  host: 'localhost',
  port: 6379,
  password: 'secret',
  keyPrefix: 'myapp:',
  enableAnalytics: true,
  defaultTTL: 3600
});

// Memory configuration
const cache = serviceRegistry.cache('memory', {
  maxSize: 1000,
  enableAnalytics: true,
  defaultTTL: 3600
});
```

### DataServe Service

**Purpose**: Persistent key-value data storage

**Providers**:
- `memory`: In-memory storage
- `simpledb`: AWS SimpleDB
- `file`: File-based storage

**Methods**:
```javascript
await dataServe.put(key, value);       // Store persistently
const value = await dataServe.get(key); // Retrieve
await dataServe.delete(key);           // Remove
const status = dataServe.status;       // Service status
```

### Filing Service

**Purpose**: File upload, download, and management

**Providers**:
- `local`: Local filesystem
- `ftp`: FTP server
- `s3`: AWS S3
- `git`: Git repository
- `sync`: Synchronized filing

**Methods**:
```javascript
await filing.create(path, content);    // Upload file
const content = await filing.read(path); // Download
await filing.delete(path);             // Remove file
const exists = await filing.exists(path); // Check existence
const metadata = await filing.getMetadata(path); // File info
```

### Logging Service

**Purpose**: Application logging and monitoring

**Providers**:
- `console`: Console output
- `file`: File-based with rotation

**Methods**:
```javascript
logger.info(message, ...args);         // Info level
logger.warn(message, ...args);         // Warning level
logger.error(message, ...args);        // Error level
logger.debug(message, ...args);        // Debug level
```

### Measuring Service

**Purpose**: Metrics collection and time-series data

**Methods**:
```javascript
measuring.add(metric, value, timestamp?); // Record measurement
const data = measuring.list(metric, startDate, endDate); // Query range
const total = measuring.total(metric, startDate, endDate); // Sum values
const avg = measuring.average(metric, startDate, endDate); // Average
```

### Notifying Service

**Purpose**: Pub/sub messaging system

**Methods**:
```javascript
notifying.createTopic(topicName);       // Create topic
notifying.subscribe(topic, callback);   // Add subscriber
notifying.notify(topic, message);       // Publish message
notifying.unsubscribe(topic, callback); // Remove subscriber
```

### Queueing Service

**Purpose**: FIFO task queue processing

**Methods**:
```javascript
queue.enqueue(task);                   // Add task
const task = queue.dequeue();          // Get next task
const size = queue.size();             // Queue size
queue.clear();                         // Empty queue
```

### Scheduling Service

**Purpose**: Delayed and recurring task execution

**Methods**:
```javascript
const taskId = scheduling.schedule(name, script, data, delay, callback);
scheduling.cancel(taskId);             // Cancel scheduled task
const status = scheduling.status;      // Scheduler status
```

### Searching Service

**Purpose**: Full-text search and indexing

**Methods**:
```javascript
searching.add(id, object);             // Index object
const results = searching.search(term); // Search
searching.delete(id);                  // Remove from index
```

### Workflow Service

**Purpose**: Multi-step workflow orchestration

**Methods**:
```javascript
await workflow.defineWorkflow(name, steps); // Define workflow
workflow.runWorkflow(name, data, callback);  // Execute
const status = workflow.status;              // Service status
```

### Working Service

**Purpose**: Background script execution

**Methods**:
```javascript
worker.start(scriptPath, callback);    // Start worker
worker.stop();                        // Stop worker
const status = worker.status;          // Worker status
```

---

## Configuration

### Environment Configuration

```bash
# .env file
NODE_ENV=production
PORT=3000

# API Keys
API_KEY_1=your-production-api-key-here
API_KEY_2=your-backup-api-key-here

# Redis Configuration
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# AWS Configuration
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Database
DB_HOST=db.example.com
DB_PORT=5432
DB_NAME=myapp
DB_USER=myuser
DB_PASS=mypass

# File Storage
UPLOAD_DIR=/var/uploads
S3_BUCKET=myapp-files
```

### Service-Specific Configuration

```javascript
// config/services.js
module.exports = {
  cache: {
    provider: process.env.CACHE_PROVIDER || 'memory',
    redis: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      keyPrefix: process.env.REDIS_PREFIX || 'myapp:'
    }
  },
  
  dataServe: {
    provider: process.env.DATA_PROVIDER || 'memory',
    simpledb: {
      domain: process.env.SIMPLEDB_DOMAIN,
      region: process.env.AWS_REGION
    }
  },
  
  filing: {
    provider: process.env.FILE_PROVIDER || 'local',
    local: {
      baseDir: process.env.UPLOAD_DIR || './uploads'
    },
    s3: {
      bucket: process.env.S3_BUCKET,
      region: process.env.AWS_REGION
    }
  },
  
  logging: {
    provider: process.env.LOG_PROVIDER || 'console',
    file: {
      filename: process.env.LOG_FILE || './app.log',
      maxFiles: 5,
      maxSize: '10m'
    }
  }
};
```

### Application Configuration Pattern

```javascript
// app.js
const config = require('./config/services');
const serviceRegistry = require('noobly-core');

const app = express();

// Initialize with configuration
serviceRegistry.initialize(app, {
  apiKeys: [
    process.env.API_KEY_1,
    process.env.API_KEY_2
  ].filter(Boolean),
  requireApiKey: process.env.NODE_ENV === 'production'
});

// Configure services with environment-specific providers
const cache = serviceRegistry.cache(
  config.cache.provider,
  config.cache[config.cache.provider]
);

const dataServe = serviceRegistry.dataServe(
  config.dataServe.provider,
  config.dataServe[config.dataServe.provider]
);

const filing = serviceRegistry.filing(
  config.filing.provider,
  config.filing[config.filing.provider]
);
```

---

## Deployment

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/services/caching/api/status || exit 1

# Start application
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - API_KEY_1=${API_KEY_1}
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

### Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nooblyjs-core
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nooblyjs-core
  template:
    metadata:
      labels:
        app: nooblyjs-core
    spec:
      containers:
      - name: app
        image: your-registry/nooblyjs-core:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: REDIS_HOST
          value: "redis-service"
        - name: API_KEY_1
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: api-key-1
        readinessProbe:
          httpGet:
            path: /services/caching/api/status
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        livenessProbe:
          httpGet:
            path: /services/caching/api/status
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10

---
apiVersion: v1
kind: Service
metadata:
  name: nooblyjs-core-service
spec:
  selector:
    app: nooblyjs-core
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

### Process Manager (PM2)

```json
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'nooblyjs-core',
    script: './app.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      CACHE_PROVIDER: 'redis',
      REDIS_HOST: 'localhost'
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

```bash
# Deploy with PM2
pm2 start ecosystem.config.js --env production
pm2 startup
pm2 save
```

---

## Testing

### API Testing

The framework includes comprehensive HTTP test files in `/tests/api/`:

```bash
# Using REST Client extension in VS Code
# Open tests/api/caching/caching.http
# Set variables at the top:
@baseUrl = http://localhost:3000
@apiKey = your-api-key-here

# Then execute requests directly in editor
```

### Unit Testing

```javascript
// tests/unit/cache.test.js
const serviceRegistry = require('../../index');

describe('Caching Service', () => {
  let cache;
  
  beforeEach(() => {
    cache = serviceRegistry.cache('memory');
  });
  
  test('should store and retrieve data', async () => {
    await cache.put('test-key', { data: 'test-value' });
    const result = await cache.get('test-key');
    expect(result.data).toBe('test-value');
  });
  
  test('should handle non-existent keys', async () => {
    const result = await cache.get('non-existent');
    expect(result).toBeNull();
  });
});
```

### Load Testing

```javascript
// tests/load/caching/loadTest.js
const axios = require('axios');

const baseUrl = 'http://localhost:3000';
const apiKey = 'your-test-api-key';

async function runLoadTest() {
  const concurrent = 100;
  const requests = 1000;
  
  console.log(`Starting load test: ${concurrent} concurrent, ${requests} total`);
  
  const promises = [];
  for (let i = 0; i < requests; i++) {
    promises.push(
      axios.post(`${baseUrl}/services/caching/api/put/test-${i}`, 
        { data: `test-data-${i}` },
        { headers: { 'x-api-key': apiKey } }
      )
    );
    
    if (promises.length >= concurrent) {
      await Promise.all(promises);
      promises.length = 0;
    }
  }
  
  if (promises.length > 0) {
    await Promise.all(promises);
  }
  
  console.log('Load test completed');
}

runLoadTest().catch(console.error);
```

### Integration Testing

```javascript
// tests/integration/workflow.test.js
const serviceRegistry = require('../../index');
const express = require('express');

describe('Service Integration', () => {
  let app, cache, queue, workflow;
  
  beforeAll(() => {
    app = express();
    serviceRegistry.initialize(app);
    
    cache = serviceRegistry.cache('memory');
    queue = serviceRegistry.queue('memory');
    workflow = serviceRegistry.workflow('memory');
  });
  
  test('workflow should process queue tasks', async () => {
    // Define workflow that processes queue
    await workflow.defineWorkflow('queueProcessor', [
      './tests/steps/dequeueTask.js',
      './tests/steps/processTask.js',
      './tests/steps/cacheResult.js'
    ]);
    
    // Add task to queue
    queue.enqueue({ type: 'test', data: 'test-data' });
    
    // Run workflow
    await new Promise((resolve) => {
      workflow.runWorkflow('queueProcessor', {}, resolve);
    });
    
    // Verify result was cached
    const result = await cache.get('processed-result');
    expect(result).toBeDefined();
  });
});
```

---

## Best Practices

### Service Architecture

1. **Use Appropriate Providers**
   ```javascript
   // Development
   const cache = serviceRegistry.cache('memory');
   
   // Production
   const cache = serviceRegistry.cache('redis', {
     host: process.env.REDIS_HOST,
     enableAnalytics: true
   });
   ```

2. **Implement Error Handling**
   ```javascript
   try {
     const data = await cache.get('user:123');
     if (!data) {
       data = await fetchUserFromDatabase('123');
       await cache.put('user:123', data, 3600);
     }
     return data;
   } catch (error) {
     logger.error('Cache error:', error);
     // Fallback to database
     return await fetchUserFromDatabase('123');
   }
   ```

3. **Use Event-Driven Patterns**
   ```javascript
   const eventEmitter = serviceRegistry.getEventEmitter();
   
   // Business logic
   eventEmitter.on('user-registered', async (userData) => {
     await cache.put(`user:${userData.id}`, userData);
     queue.enqueue({ type: 'sendWelcomeEmail', userId: userData.id });
     measuring.add('user.registration', 1);
   });
   ```

### Performance Optimization

1. **Cache Strategy**
   ```javascript
   // Cache frequently accessed data
   async function getUser(id) {
     const cacheKey = `user:${id}`;
     
     // Try cache first
     let user = await cache.get(cacheKey);
     if (user) return user;
     
     // Fallback to database
     user = await db.user.findById(id);
     if (user) {
       await cache.put(cacheKey, user, 1800); // 30 min
     }
     
     return user;
   }
   ```

2. **Background Processing**
   ```javascript
   // Don't block request handling
   app.post('/api/orders', async (req, res) => {
     const order = await processOrder(req.body);
     
     // Queue background tasks instead of blocking
     queue.enqueue({ type: 'sendOrderConfirmation', orderId: order.id });
     queue.enqueue({ type: 'updateInventory', items: order.items });
     queue.enqueue({ type: 'processPayment', orderId: order.id });
     
     res.json({ orderId: order.id, status: 'processing' });
   });
   ```

3. **Monitoring and Metrics**
   ```javascript
   // Track important metrics
   const startTime = Date.now();
   
   try {
     const result = await businessLogic();
     measuring.add('api.response.time', Date.now() - startTime);
     measuring.add('api.success', 1);
     return result;
   } catch (error) {
     measuring.add('api.error', 1);
     throw error;
   }
   ```

### Security Best Practices

1. **API Key Rotation**
   ```javascript
   // Implement key rotation
   const activeKeys = [
     process.env.API_KEY_CURRENT,
     process.env.API_KEY_PREVIOUS  // Allow previous key during rotation
   ].filter(Boolean);
   
   serviceRegistry.initialize(app, { 
     apiKeys: activeKeys,
     requireApiKey: true 
   });
   ```

2. **Input Validation**
   ```javascript
   app.post('/api/cache', (req, res) => {
     const { key, value } = req.body;
     
     // Validate inputs
     if (!key || typeof key !== 'string' || key.length > 255) {
       return res.status(400).json({ error: 'Invalid key' });
     }
     
     if (typeof value === 'undefined') {
       return res.status(400).json({ error: 'Value required' });
     }
     
     // Process safely
     cache.put(key, value);
     res.json({ success: true });
   });
   ```

3. **Rate Limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');
   
   app.use('/services/', rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 1000, // requests per window per IP
     message: 'Too many requests, please try again later.'
   }));
   ```

---

## Troubleshooting

### Common Issues

#### 1. "ServiceRegistry must be initialized before getting services"

```javascript
// ❌ Wrong: Getting service before initialization
const cache = serviceRegistry.cache('redis');
serviceRegistry.initialize(app);

// ✅ Correct: Initialize first
serviceRegistry.initialize(app);
const cache = serviceRegistry.cache('redis');
```

#### 2. API Key Authentication Failures

```bash
# Check if API key is being sent correctly
curl -v -H "x-api-key: YOUR_KEY" http://localhost:3000/services/caching/api/status

# Verify key in excluded paths
GET /services/caching/api/status  # Should work without key
GET /services/caching/api/get/test # Requires key
```

#### 3. Redis Connection Issues

```javascript
// Add Redis connection handling
const cache = serviceRegistry.cache('redis', {
  host: 'localhost',
  port: 6379,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true
});

// Listen for connection events
const eventEmitter = serviceRegistry.getEventEmitter();
eventEmitter.on('redis-error', (error) => {
  console.error('Redis error:', error);
  // Maybe fallback to memory cache
});
```

#### 4. File Upload Issues

```javascript
// Check file permissions and paths
const filing = serviceRegistry.filing('local', {
  baseDir: path.resolve(__dirname, 'uploads') // Use absolute path
});

// Ensure directory exists
const fs = require('fs');
const uploadDir = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
```

### Debugging

#### Enable Debug Logging

```bash
# Set environment variable
DEBUG=noobly:* npm start
```

```javascript
// Or programmatically
process.env.DEBUG = 'noobly:*';

// Add debug logging
const debug = require('debug')('noobly:app');
debug('Service initialized with providers:', providers);
```

#### Monitor Service Events

```javascript
const eventEmitter = serviceRegistry.getEventEmitter();

// Log all events for debugging
const originalEmit = eventEmitter.emit;
eventEmitter.emit = function(eventName, ...args) {
  console.log(`Event: ${eventName}`, args);
  return originalEmit.call(this, eventName, ...args);
};
```

#### Health Check Endpoints

```javascript
// Add comprehensive health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };
  
  // Check each service
  try {
    const cache = serviceRegistry.cache('redis');
    await cache.get('health-check');
    health.services.cache = 'ok';
  } catch (error) {
    health.services.cache = 'error';
    health.status = 'degraded';
  }
  
  // Check Redis connection
  try {
    const redis = serviceRegistry.cache('redis');
    health.services.redis = redis.status || 'ok';
  } catch (error) {
    health.services.redis = 'error';
    health.status = 'degraded';
  }
  
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});
```

### Performance Issues

#### Memory Leaks

```javascript
// Monitor memory usage
setInterval(() => {
  const memUsage = process.memoryUsage();
  measuring.add('memory.heap.used', memUsage.heapUsed);
  measuring.add('memory.heap.total', memUsage.heapTotal);
  
  if (memUsage.heapUsed > 512 * 1024 * 1024) { // 512MB
    logger.warn('High memory usage detected:', memUsage);
  }
}, 30000);
```

#### Connection Pool Tuning

```javascript
// Optimize Redis connections
const cache = serviceRegistry.cache('redis', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: true,
  family: 4, // Force IPv4
  connectTimeout: 10000,
  commandTimeout: 5000
});
```

---

## Conclusion

This technical guide provides comprehensive coverage of the NooblyJS Core framework usage patterns. The framework's modular architecture, multiple provider support, and consistent API patterns make it suitable for a wide range of applications from rapid prototypes to production systems.

For additional support:
- Check the `/tests/api/` directory for HTTP test examples
- Review `/tests/unit/` for programmatic usage patterns  
- Examine `/tests/load/` for performance testing approaches
- Use the web interfaces at `/services/` for interactive exploration

The framework's event-driven architecture and service registry pattern provide a solid foundation for building scalable, maintainable backend applications with Node.js.