# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start development server with nodemon watching src/ directory
- `npm run clean` - Clean dist/ and docs/ directories

### Testing
- `npm test` - Run Jest test suite
- `npm run test-load` - Run load tests from tests-load/ directory

### Building & Publishing
- `npm run build` - Generate JSDoc documentation, bump version, transpile with Babel to dist/, and create npm package
- Use `node ./tests-load/` to run load testing

### Manual Testing
- API tests are available in `tests-api/` directory as .http files for manual testing with REST clients

## Architecture

**nooblyjs-core** is a modular Node.js backend framework that provides pluggable core services. The architecture follows a consistent factory pattern across all services:

### Core Pattern
Each service module follows this structure:
- `src/{service}/index.js` - Factory function that creates service instances
- `src/{service}/providers/` - Different implementation providers (memory, redis, s3, etc.)
- `src/{service}/routes/` - Express route definitions for REST API
- `src/{service}/views/` - Optional UI views (caching service only)

### Service Architecture
Services are initialized with three parameters:
1. **Provider type** (string) - Determines which implementation to use (e.g., 'memory', 'redis', 'file')
2. **Options object** - Contains configuration including `'express-app'` reference
3. **EventEmitter** - Global event system for inter-service communication

### Available Services

#### 🗃️ Caching Service
- **Providers:** `memory`, `redis`, `memcached`
- **Features:** Analytics tracking, hit/miss statistics, LRU eviction
- **Use case:** High-performance data caching with distributed cache support

#### 📊 Data Serving Service  
- **Providers:** `memory`, `simpledb`, `file`
- **Features:** CRUD operations, data persistence, simple queries
- **Use case:** Persistent key-value data storage

#### 📁 Filing Service
- **Providers:** `local`, `ftp`, `s3`
- **Features:** File operations, metadata handling, cloud storage integration
- **Use case:** File upload, download, and management

#### 📝 Logging Service
- **Providers:** `console`, `file`
- **Features:** Multiple log levels, structured logging, file rotation
- **Use case:** Application logging and monitoring

#### 📈 Measuring Service
- **Providers:** `memory`
- **Features:** Time-series data, aggregation functions, date range queries
- **Use case:** Metrics collection and aggregation

#### 🔔 Notifying Service
- **Providers:** `memory`
- **Features:** Topic-based messaging, multiple subscribers, event broadcasting
- **Use case:** Pub/sub notification system

#### 🚀 Queueing Service
- **Providers:** `memory` (InMemoryQueue implementation)
- **Features:** FIFO processing, queue size monitoring, async task handling
- **Use case:** Task queuing and background job processing

#### ⏰ Scheduling Service
- **Providers:** `memory`
- **Features:** Delayed execution, recurring tasks, callback handling
- **Use case:** Cron-like task scheduling

#### 🔍 Searching Service
- **Providers:** `memory`
- **Features:** Object indexing, text search, query capabilities
- **Use case:** Full-text search and indexing

#### 🔄 Workflow Service
- **Providers:** `memory`
- **Features:** Step-based workflows, worker threads, error handling, parallel execution
- **Use case:** Multi-step workflow orchestration

#### ⚙️ Working Service
- **Providers:** `memory`
- **Features:** Script execution, worker management, task lifecycle management
- **Use case:** Background task execution

### Main Application
- `index.js` - ServiceRegistry class that manages all services with singleton pattern
- `sample-app.js` - Example application demonstrating all services
- Services are auto-registered with Express routes under `/api/{service}/` paths
- Event system is patched to log all events for debugging
- Static UI themes served from `ui-design/` directory

### Current Features & Capabilities

#### Service Registry
- Singleton pattern implementation for all services
- Global event emitter for inter-service communication
- Dynamic service initialization with pluggable providers
- Service lifecycle management (initialize, reset, list services)

#### UI Themes (5 available)
- **Glass** (`/`) - Glassmorphism design with transparency effects
- **Flat** (`/flat`) - Flat design with clean, minimal aesthetics
- **Material** (`/material`) - Material Design principles
- **Minimalist** (`/minimalist`) - Ultra-clean minimalist interface
- **Shadcn** (`/shadcn`) - Modern component-based design

#### Provider Implementations
- **Memory providers** - Fast in-memory implementations for all services
- **Redis integration** - Distributed caching with analytics
- **AWS S3 integration** - Cloud file storage with full S3 API support
- **FTP support** - File transfer protocol for legacy systems
- **File system providers** - Local file operations
- **Memcached support** - Alternative caching backend

#### Advanced Features
- **Worker Threads** - Workflow service uses worker threads for step execution
- **Analytics** - Cache service includes hit/miss analytics and performance metrics
- **Event-driven architecture** - All services can communicate via global EventEmitter
- **Load balancing ready** - Stateless APIs suitable for horizontal scaling
- **Testing suite** - Comprehensive unit, load, and API tests included
- **Docker support** - Dockerfile provided for containerized deployment

### REST API Structure
All services expose consistent REST endpoints:
- `GET /api/{service}/status` - Service health check
- Service-specific CRUD operations following RESTful conventions
- See README.md for complete API documentation

### File Organization
- `src/` - Source code organized by service
- `tests/` - Jest unit tests organized by service
- `tests-api/` - HTTP files for manual API testing
- `tests-load/` - Load testing scripts
- `ui-design/` - Multiple UI theme implementations
- `dist/` - Babel-transpiled production code (generated)
- `docs/` - JSDoc-generated documentation (generated)

### Configuration
- Uses CommonJS modules (`"type": "commonjs"`)
- Babel transpilation configured for Node.js current version
- JSDoc documentation generation to `docs/` directory
- Jest configured with `forceExit` and `detectOpenHandles` for proper cleanup