# NooblyJS Load Testing Suite

Comprehensive load testing framework for all NooblyJS Core services. Tests both direct service providers and HTTP API endpoints with API key authentication support.

## Overview

The load testing suite includes two types of tests:

1. **Provider-Level Tests**: Direct testing of service instances (memory, file, Redis, etc.)
2. **HTTP API Tests**: REST endpoint testing with authentication and realistic payloads

## Quick Start

### Basic Usage

```bash
# Run all tests with default configuration
node tests/load/index.js

# Run only HTTP API tests with quick scenario
node tests/load/index.js http quick

# Run only provider tests
node tests/load/index.js provider

# Run stress test scenario
node tests/load/index.js http stress
```

### With API Key Authentication

```bash
# Set environment variables for authenticated testing
export TEST_API_KEY="your-api-key-here"
export TEST_BASE_URL="http://localhost:3000"

# Run HTTP tests with authentication
node tests/load/index.js http standard
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_PROVIDERS` | Enable provider-level tests | `true` |
| `TEST_HTTP` | Enable HTTP API tests | `true` |
| `TEST_BASE_URL` | Base URL for HTTP tests | `http://localhost:3000` |
| `TEST_API_KEY` | API key for authenticated tests | `null` |
| `PROVIDER_ITERATIONS` | Iterations for provider tests | `100` |
| `HTTP_ITERATIONS` | Iterations for HTTP tests | `500` |
| `HTTP_CONCURRENCY` | Concurrent requests for HTTP tests | `10` |

### Test Scenarios

| Scenario | Iterations | Concurrency | Purpose |
|----------|------------|-------------|---------|
| `quick` | 100 | 5 | Fast validation |
| `standard` | 500 | 10 | Regular testing |
| `stress` | 2000 | 50 | High load testing |
| `soak` | 10000 | 20 | Endurance testing |

## Supported Services

### HTTP API Endpoints Tested

Each service includes both public status endpoints and authenticated API endpoints:

#### Caching Service
- `GET /services/caching/api/status` (public)
- `POST /services/caching/api/put/loadtest-key` (authenticated)
- `GET /services/caching/api/get/loadtest-key` (authenticated)

#### Dataserve Service
- `GET /services/dataserve/api/status` (public)
- `POST /services/dataserve/api/put/loadtest-key` (authenticated)
- `GET /services/dataserve/api/get/loadtest-key` (authenticated)

#### Filing Service
- `GET /services/filing/api/status` (public)
- `POST /services/filing/api/upload` (authenticated)
- `GET /services/filing/api/list` (authenticated)

#### Logging Service
- `GET /services/logging/api/status` (public)
- `POST /services/logging/api/info` (authenticated)

#### Measuring Service
- `GET /services/measuring/api/status` (public)
- `POST /services/measuring/api/add` (authenticated)

#### Notifying Service
- `GET /services/notifying/api/status` (public)
- `POST /services/notifying/api/topic` (authenticated)

#### Queueing Service
- `GET /services/queueing/api/status` (public)
- `POST /services/queueing/api/push` (authenticated)

#### Scheduling Service
- `GET /services/scheduling/api/status` (public)
- `POST /services/scheduling/api/schedule` (authenticated)

#### Searching Service
- `GET /services/searching/api/status` (public)
- `POST /services/searching/api/add` (authenticated)
- `POST /services/searching/api/search` (authenticated)

#### Workflow Service
- `GET /services/workflow/api/status` (public)
- `POST /services/workflow/api/create` (authenticated)
- `GET /services/workflow/api/list` (authenticated)

#### Working Service
- `GET /services/working/api/status` (public)
- `POST /services/working/api/add` (authenticated)
- `GET /services/working/api/status` (authenticated)

### Provider-Level Tests

Direct testing of service providers with configurable backends:

- **Caching**: memory, Redis, Memcached
- **Dataserve**: memory, file, SimpleDB
- **Filing**: local, FTP, S3
- **Logging**: console, file
- **Measuring**: metrics collection and aggregation
- **Notifying**: topic management
- **Queueing**: message queue operations
- **Scheduling**: task scheduling
- **Searching**: document indexing and search
- **Workflow**: workflow creation and management
- **Working**: job processing

## Authentication Methods

The HTTP load tests support all NooblyJS API key authentication methods:

1. **x-api-key Header** (recommended)
   ```
   x-api-key: your-api-key-here
   ```

2. **Authorization Bearer**
   ```
   Authorization: Bearer your-api-key-here
   ```

3. **ApiKey Header**
   ```
   ApiKey: your-api-key-here
   ```

4. **Query Parameter**
   ```
   ?apiKey=your-api-key-here
   ```

## Performance Metrics

The load testing suite measures:

- **Operations per second** (ops/sec)
- **Average latency** (ms)
- **Success rate** (%)
- **Total duration** (ms)
- **Min/max latency** (HTTP tests only)

## Sample Output

```
=== NooblyJS Core Load Testing Suite ===
Test Type: http
Scenario: standard
Configuration: {
  provider: { enabled: true, iterations: 100 },
  http: { enabled: true, baseUrl: 'http://localhost:3000', apiKey: '***' }
}

--- Running HTTP API Load Tests ---
🚀 Starting HTTP Load Tests
   Base URL: http://localhost:3000
   API Key: ✅ Provided
   Iterations: 500 per service
   Concurrency: 10 concurrent requests

📊 Testing caching service...
   ✅ 500 successful, ❌ 0 failed
   📈 Success rate: 100.0%
   ⚡ Avg latency: 25.34ms

=== LOAD TEST RESULTS SUMMARY ===
✅ Successful Tests: 11
❌ Failed Tests: 0

--- Performance Results ---
caching         (http-api):    500 ops in   2534ms |    197 ops/sec | 5.07ms avg
dataserve       (http-api):    500 ops in   2891ms |    173 ops/sec | 5.78ms avg
logging         (http-api):    500 ops in   1234ms |    405 ops/sec | 2.47ms avg

--- Overall Statistics ---
Total Operations: 5,500
Total Duration: 28,456ms
Average Throughput: 193 ops/sec
```

## Advanced Usage

### Custom Configuration

Create a custom configuration file:

```javascript
// custom-load-test.js
const { runAllLoadTests, LOAD_TEST_CONFIG } = require('./index');

// Override default configuration
LOAD_TEST_CONFIG.http.iterations = 1000;
LOAD_TEST_CONFIG.http.concurrency = 20;
LOAD_TEST_CONFIG.http.baseUrl = 'https://your-api-server.com';

// Run with custom config
runAllLoadTests('http', 'custom');
```

### Selective Service Testing

Modify the HTTP load test configuration to test specific services:

```javascript
// Edit tests/load/http/httpLoadTest.js
// Comment out services you don't want to test
const services = [
  cachingService,
  // dataserveService,  // Commented out
  loggingService,
  // ... other services
];
```

### CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Run Load Tests
  run: |
    export TEST_API_KEY="${{ secrets.API_KEY }}"
    export TEST_BASE_URL="http://localhost:3000"
    node tests/load/index.js http quick
  env:
    NODE_ENV: test
```

## Troubleshooting

### Connection Errors
- Ensure the NooblyJS server is running on the configured URL
- Check API key configuration and permissions
- Verify network connectivity and firewall settings

### High Error Rates
- Reduce concurrency levels for slower servers
- Increase timeouts in HTTP configuration
- Check server logs for specific error messages

### Performance Issues
- Monitor server resources during tests
- Use smaller test scenarios for debugging
- Check individual service configurations

## Contributing

When adding new services or endpoints:

1. Add provider-level tests in `tests/load/{service}/loadTest.js`
2. Add HTTP endpoint configurations in `tests/load/http/httpLoadTest.js`
3. Update this documentation
4. Test with both authenticated and public endpoints

## Files Structure

```
tests/load/
├── index.js                    # Main test runner
├── README.md                   # This documentation
├── http/
│   └── httpLoadTest.js        # HTTP API load testing framework
├── caching/
│   └── loadTest.js            # Caching service provider tests
├── dataserve/
│   └── loadTest.js            # Dataserve service provider tests
├── filing/
│   └── loadTest.js            # Filing service provider tests
├── logging/
│   └── loadTest.js            # Logging service provider tests
├── measuring/
│   └── loadTest.js            # Measuring service provider tests
├── notifying/
│   └── loadTest.js            # Notifying service provider tests
├── queueing/
│   └── loadTest.js            # Queueing service provider tests
├── scheduling/
│   └── loadTest.js            # Scheduling service provider tests
├── searching/
│   └── loadTest.js            # Searching service provider tests
├── workflow/
│   └── loadTest.js            # Workflow service provider tests
└── working/
    └── loadTest.js            # Working service provider tests
```