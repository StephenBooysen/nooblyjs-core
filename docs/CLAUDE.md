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
- **Caching** - Memory, Redis, Memcached providers
- **Data Serving** - Simple key-value storage with SimpleDB and file providers
- **Filing** - File management with Local, FTP, S3 providers
- **Logging** - Console and file logging providers
- **Measuring** - Metrics collection and aggregation
- **Notifying** - Pub/sub notification system
- **Queueing** - In-memory queue implementation
- **Scheduling** - Task scheduling with cron-like functionality
- **Searching** - Simple in-memory search functionality
- **Workflow** - Step-based workflow orchestration
- **Working** - Background task execution

### Main Application
- `app.js` - Main entry point that initializes all services and Express server
- Services are auto-registered with Express routes under `/api/{service}/` paths
- Event system is patched to log all events for debugging
- Static UI themes served from `ui-design/` directory

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