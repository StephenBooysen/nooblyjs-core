# API Key Authentication Setup

NooblyJS Core now supports API key authentication to secure your service endpoints. This document explains how to configure and use API key authentication.

## Quick Start

```javascript
const express = require('express');
const serviceRegistry = require('nooblyjs-core');

const app = express();
app.use(express.json());

// Generate API keys
const apiKey1 = serviceRegistry.generateApiKey(32);
const apiKey2 = serviceRegistry.generateApiKey(32);

console.log('API Keys:', { apiKey1, apiKey2 });

// Initialize with API key authentication
serviceRegistry.initialize(app, {
  apiKeys: [apiKey1, apiKey2],           // Array of valid API keys
  requireApiKey: true,                   // Enable API key requirement
  excludePaths: [                        // Paths that don't require API keys
    '/services/*/status',                // Status endpoints
    '/services/',                        // Main services page
    '/services/*/views/*'                // HTML admin interfaces
  ]
});

// Your services will now require API keys for /services/*/api/* routes
const cache = serviceRegistry.cache('memory');
const dataServe = serviceRegistry.dataServe('memory');

app.listen(3000);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKeys` | `string[]` | `[]` | Array of valid API keys |
| `requireApiKey` | `boolean` | `true` | Whether to require API keys |
| `excludePaths` | `string[]` | See below | Paths to exclude from authentication |

### Default Excluded Paths
- `/services/*/status` - Service status endpoints
- `/services/` - Main services landing page  
- `/services/*/views/*` - HTML admin interfaces

## API Key Usage

API keys can be provided in several ways:

### 1. x-api-key Header (Recommended)
```bash
curl -X POST http://localhost:3000/services/caching/api/put/mykey \
  -H "x-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello World"}'
```

### 2. Authorization Header (Bearer Token)
```bash
curl -X POST http://localhost:3000/services/caching/api/put/mykey \
  -H "Authorization: Bearer your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello World"}'
```

### 3. Authorization Header (ApiKey)
```bash
curl -X POST http://localhost:3000/services/caching/api/put/mykey \
  -H "Authorization: ApiKey your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello World"}'
```

### 4. Query Parameter
```bash
curl -X POST "http://localhost:3000/services/caching/api/put/mykey?api_key=your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello World"}'
```

### 5. api-key Header
```bash
curl -X POST http://localhost:3000/services/caching/api/put/mykey \
  -H "api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello World"}'
```

## Generating API Keys

```javascript
const serviceRegistry = require('nooblyjs-core');

// Generate a 32-character API key
const apiKey = serviceRegistry.generateApiKey(32);

// Generate a 64-character API key
const longApiKey = serviceRegistry.generateApiKey(64);
```

## Error Responses

### Missing API Key (401)
```json
{
  "error": "Unauthorized",
  "message": "API key is required. Provide it via x-api-key header, Authorization header, or api_key query parameter.",
  "code": "MISSING_API_KEY"
}
```

### Invalid API Key (401)
```json
{
  "error": "Unauthorized", 
  "message": "Invalid API key provided.",
  "code": "INVALID_API_KEY"
}
```

## Security Best Practices

1. **Store API keys securely** - Use environment variables or secure key management systems
2. **Use HTTPS** - Always use HTTPS in production to prevent key interception
3. **Rotate keys regularly** - Generate new keys periodically
4. **Monitor usage** - Track API key usage and watch for suspicious activity
5. **Limit key scope** - Use different keys for different applications/users

## Environment Variables

You can use environment variables to manage API keys:

```javascript
const apiKeys = [
  process.env.API_KEY_1,
  process.env.API_KEY_2,
  process.env.API_KEY_3
].filter(Boolean); // Remove undefined values

serviceRegistry.initialize(app, {
  apiKeys,
  requireApiKey: process.env.REQUIRE_API_KEY !== 'false'
});
```

## Swagger/OpenAPI Integration

The Swagger documentation is automatically updated to include API key authentication requirements. Visit any service's HTML interface (e.g., `/services/caching/`) to see the interactive API documentation with authentication.

## Event Monitoring

Monitor authentication events:

```javascript
serviceRegistry.getEventEmitter().on('api-auth-success', (data) => {
  console.log('API authentication successful:', data);
});

serviceRegistry.getEventEmitter().on('api-auth-failure', (data) => {
  console.log('API authentication failed:', data);
});

serviceRegistry.getEventEmitter().on('api-auth-setup', (data) => {
  console.log('API authentication setup:', data);
});
```

## Disabling Authentication

To disable API key authentication:

```javascript
serviceRegistry.initialize(app, {
  requireApiKey: false
});

// Or simply don't provide apiKeys
serviceRegistry.initialize(app);
```

## Protected Endpoints

When API key authentication is enabled, the following endpoints require authentication:

- `/services/caching/api/*` - All caching API endpoints
- `/services/dataserve/api/*` - All data serving API endpoints  
- `/services/filing/api/*` - All filing API endpoints
- `/services/logging/api/*` - All logging API endpoints
- `/services/measuring/api/*` - All measuring API endpoints
- `/services/notifying/api/*` - All notification API endpoints
- `/services/queueing/api/*` - All queueing API endpoints
- `/services/scheduling/api/*` - All scheduling API endpoints
- `/services/searching/api/*` - All search API endpoints
- `/services/working/api/*` - All worker API endpoints
- `/services/workflow/api/*` - All workflow API endpoints

Status endpoints (`/services/*/status`) and HTML interfaces (`/services/*/views/*`) remain accessible without API keys for monitoring and administration.