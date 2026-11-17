---
type: Guide
title: Installation and Setup Guide - NooblyJS Notifying Client Library
description: The NooblyJS Notifying Service Client Library is a lightweight JavaScript library that enables web applications to use the notifying service's pub/sub messaging capabilities without building...
---

# Installation and Setup Guide - NooblyJS Notifying Client Library

## Overview

The NooblyJS Notifying Service Client Library is a lightweight JavaScript library that enables web applications to use the notifying service's pub/sub messaging capabilities without building custom API integrations.

## Quick Start

### 1. Include the Script

In your HTML file, add a script tag pointing to the notifying scripts endpoint:

```html
<script src="/services/notifying/scripts"></script>
```

### 2. Initialize the Service

```javascript
const notifying = new nooblyjsNotifying({
  instanceName: 'default'  // Optional
});
```

### 3. Create Topics and Subscribe

```javascript
// Create a topic
await notifying.createTopic('my-topic');

// Subscribe to receive notifications
await notifying.subscribe('my-topic', (message) => {
  console.log('Received:', message);
});

// Publish a notification
await notifying.notify('my-topic', {
  data: 'Hello World'
});
```

## Installation Details

### How It's Served

The library is automatically served by the NotifyingScripts module at two URLs:

1. **Main entry point (recommended):**
   ```
   GET /services/notifying/scripts
   ```
   Returns the compiled JavaScript library that automatically exposes the `nooblyjsNotifying` class.

2. **Direct file access:**
   ```
   GET /services/notifying/scripts/js/index.js
   ```
   Returns the same library file directly.

3. **Static assets:**
   ```
   GET /services/notifying/scripts/example.html
   GET /services/notifying/scripts/README.md
   ```
   Serve documentation and examples.

### File Structure

```
src/notifying/scripts/
├── index.js                    # Script module initialization (registers routes)
├── js/
│   └── index.js               # Client-side JavaScript library
├── README.md                  # Comprehensive API documentation
├── INSTALLATION.md            # This file
└── example.html               # Interactive example/test page
```

### What Gets Installed

When the notifying service initializes, it automatically:

1. Registers the Scripts module in `src/notifying/index.js`
2. Sets up HTTP endpoint at `/services/notifying/scripts`
3. Serves the JavaScript library with appropriate headers
4. Enables CORS for cross-origin requests
5. Sets cache headers for 1 hour

## Configuration

The library can be configured when creating an instance:

```javascript
const notifying = new nooblyjsNotifying({
  // Instance name (for multi-instance setups)
  instanceName: 'production',

  // Base URL for API calls (defaults to current origin)
  baseUrl: 'https://api.example.com',

  // Additional headers for all requests
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});
```

## API Methods

The library provides the following methods:

### Core Methods

- `createTopic(topic)` - Create a new topic
- `subscribe(topic, callback, options)` - Subscribe to a topic
- `unsubscribe(topic, subscriptionId, options)` - Unsubscribe from a topic
- `notify(topic, message)` - Publish a notification

### Utility Methods

- `getStatus()` - Get service status
- `getInstances()` - Get available instances
- `getSwaggerSpec()` - Get OpenAPI specification
- `setPollingEnabled(enabled)` - Control polling
- `setPollingInterval(interval)` - Set polling frequency
- `getSubscriptions()` - Get all active subscriptions
- `disconnect()` - Clean up resources
- `emitToSubscribers(topic, message)` - Test helper

See `README.md` for detailed API documentation.

## Usage Examples

### Simple Pub/Sub Example

```html
<script src="/services/notifying/scripts"></script>
<script>
  const notifying = new nooblyjsNotifying();

  async function main() {
    // Create a topic
    await notifying.createTopic('alerts');

    // Subscribe to alerts
    await notifying.subscribe('alerts', (message) => {
      console.log('Alert received:', message);
    });

    // Send an alert
    await notifying.notify('alerts', {
      type: 'warning',
      message: 'System update in progress'
    });
  }

  main().catch(console.error);
</script>
```

### Real-time Updates Example

```javascript
const notifying = new nooblyjsNotifying();

// Create user events topic
await notifying.createTopic('user-events');

// Subscribe to user login events
const sub = await notifying.subscribe('user-events', (event) => {
  if (event.type === 'login') {
    updateUserUI(event.user);
  }
});

// Later, unsubscribe
await notifying.unsubscribe('user-events', sub.subscriptionId);
```

### Multi-Instance Example

```javascript
// Production instance
const prodNotifying = new nooblyjsNotifying({
  instanceName: 'production'
});

// Staging instance
const stagingNotifying = new nooblyjsNotifying({
  instanceName: 'staging'
});

// Use independently
await prodNotifying.createTopic('prod-alerts');
await stagingNotifying.createTopic('staging-alerts');
```

## Interactive Example

A complete working example is available at:

```
http://localhost:3001/services/notifying/scripts/example.html
```

This page provides:
- Service initialization
- Topic creation
- Subscription management
- Message publishing
- Real-time message display
- Active subscription listing

## Browser Compatibility

The library requires:
- Promise support (ES2015)
- Fetch API
- ES6 Class syntax

Works in:
- Chrome 49+
- Firefox 45+
- Safari 10+
- Edge 15+
- Modern mobile browsers

For older browsers, use a transpiler like Babel.

## Performance Considerations

### Polling

By default, the library uses polling (every 5 seconds) to check for messages:

```javascript
// Adjust polling interval
notifying.setPollingInterval(10000); // 10 seconds

// Disable polling to reduce network traffic
notifying.setPollingEnabled(false);
```

### Memory Management

Always clean up when done:

```javascript
// Clean up all subscriptions
notifying.disconnect();
```

## Troubleshooting

### Library Not Loading

1. Check the script URL: `GET /services/notifying/scripts`
2. Verify the notifying service is running
3. Check browser console for errors
4. Ensure JavaScript is enabled

### Subscriptions Not Working

1. Enable browser DevTools network tab
2. Check for failed fetch requests
3. Verify the topic exists (create it first)
4. Check console for error messages

### CORS Errors

The library sets `Access-Control-Allow-Origin: *` by default. If you're still getting CORS errors:

1. Verify the API is accessible from your domain
2. Check browser security settings
3. Use custom headers if needed:

```javascript
const notifying = new nooblyjsNotifying({
  headers: {
    'X-Custom-Header': 'value'
  }
});
```

## Error Handling

All methods return Promises and should be properly error-handled:

```javascript
try {
  await notifying.createTopic('my-topic');
} catch (error) {
  console.error('Failed to create topic:', error.message);
}
```

## Security Notes

1. The library uses the Fetch API with standard HTTP methods
2. No authentication headers are sent by default
3. Add custom headers for authentication:

```javascript
const notifying = new nooblyjsNotifying({
  headers: {
    'Authorization': 'Bearer TOKEN'
  }
});
```

4. All requests include `Content-Type: application/json`
5. CORS is enabled for cross-origin requests

## Support

For issues, questions, or feature requests:
- Check the README.md for detailed API documentation
- Review the example.html for working code samples
- Consult the service documentation at `/services/notifying/api/swagger/docs.json`

## Version Information

- **Library Version:** 1.0.0
- **Notifying Service Version:** 1.0.15+
- **License:** ISC
