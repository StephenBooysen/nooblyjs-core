---
type: Guide
title: NooblyJS Notifying Service - Client Library
description: A lightweight JavaScript library for integrating pub/sub messaging capabilities into web applications.
---

# NooblyJS Notifying Service - Client Library

A lightweight JavaScript library for integrating pub/sub messaging capabilities into web applications. Features both **local client-side pub/sub** (no server needed) and **remote server-side integration** (for distributed messaging).

## Installation

Include the script in your HTML file:

```html
<script src="/services/notifying/scripts"></script>
```

## Usage

### Local Client-Side Pub/Sub (No Server Required)

The library uses local client-side pub/sub by default when no `instanceName` is provided:

```javascript
// Create a local notifying instance
const notifying = new nooblyjsNotifying();  // No instanceName = local service

// Create a topic (stored locally in memory)
await notifying.createTopic('user-events');

// Subscribe to the topic
notifying.subscribe('user-events', (message) => {
  console.log('Received locally:', message);
});

// Publish a notification (calls all subscribers immediately)
await notifying.notify('user-events', {
  type: 'user-login',
  userId: '123'
});
```

**Key Characteristics:**
- ✅ No server dependency
- ✅ Instant message delivery (synchronous)
- ✅ In-memory storage (lost on page reload)
- ✅ No network latency
- ✅ Perfect for component communication

### Remote Server-Side Pub/Sub

Specify an `instanceName` to use the remote server-based notifying service:

```javascript
// Create a remote notifying instance
const notifying = new nooblyjsNotifying({
  instanceName: 'production'  // Connects to remote server
});

// Create a server-side topic
await notifying.createTopic('server-events');

// Subscribe (uses polling to check for server messages)
notifying.subscribe('server-events', (message) => {
  console.log('Received from server:', message);
});

// Publish to the server
await notifying.notify('server-events', {
  type: 'order-shipped'
});
```

**Key Characteristics:**
- ✅ Distributed messaging across clients
- ✅ Persistent storage on server
- ✅ Multi-instance support
- ✅ Polling-based message delivery
- ✅ Network-based communication

### Initialize the Library

```javascript
// Local service (default)
const localNotifying = new nooblyjsNotifying();

// Remote service with instance name
const remoteNotifying = new nooblyjsNotifying({
  instanceName: 'production'
});

// Force local service even if needed
const forced = new nooblyjsNotifying({
  useLocal: true
});
```

### Create a Topic

```javascript
// Create a new topic
await notifying.createTopic('user-events');
```

### Subscribe to a Topic

```javascript
// Subscribe to notifications
const subscription = await notifying.subscribe('user-events', (message) => {
  console.log('Received notification:', message);
});

// subscription returns:
// {
//   subscriptionId: 'unique-id',
//   topic: 'user-events',
//   status: 'subscribed'
// }
```

### Publish a Notification

```javascript
// Publish a notification to a topic
await notifying.notify('user-events', {
  type: 'user-login',
  userId: '123',
  timestamp: new Date().toISOString()
});
```

### Unsubscribe from a Topic

```javascript
// Unsubscribe from notifications
await notifying.unsubscribe('user-events', subscriptionId);
```

## Complete Examples

### Local Pub/Sub Example (No Server)

```html
<!DOCTYPE html>
<html>
<head>
  <title>Local Pub/Sub Example</title>
  <script src="/services/notifying/scripts"></script>
</head>
<body>
  <h1>Local Client-Side Pub/Sub</h1>
  <div id="messages"></div>

  <script>
    // Create local notifying service (no server needed)
    const notifying = new nooblyjsNotifying();

    async function runExample() {
      try {
        // Create a topic
        console.log('Creating topic...');
        await notifying.createTopic('notifications');

        // Subscribe to the topic
        console.log('Subscribing to topic...');
        await notifying.subscribe('notifications', (message) => {
          console.log('Received:', message);
          document.getElementById('messages').innerHTML +=
            `<p>${JSON.stringify(message)}</p>`;
        });

        // Publish a notification
        console.log('Publishing notification...');
        await notifying.notify('notifications', {
          message: 'Hello from Local Service!',
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('Error:', error);
      }
    }

    window.addEventListener('load', runExample);
  </script>
</body>
</html>
```

### Remote Server-Based Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Remote Pub/Sub Example</title>
  <script src="/services/notifying/scripts"></script>
</head>
<body>
  <h1>Remote Server-Based Pub/Sub</h1>
  <div id="messages"></div>

  <script>
    // Create remote notifying service (connects to server)
    const notifying = new nooblyjsNotifying({ instanceName: 'default' });

    async function runExample() {
      try {
        // Create a server-side topic
        console.log('Creating server topic...');
        await notifying.createTopic('server-notifications');

        // Subscribe to the topic
        console.log('Subscribing to server topic...');
        await notifying.subscribe('server-notifications', (message) => {
          console.log('Received from server:', message);
          document.getElementById('messages').innerHTML +=
            `<p>${JSON.stringify(message)}</p>`;
        });

        // Publish to the server
        console.log('Publishing to server...');
        await notifying.notify('server-notifications', {
          message: 'Hello from Remote Service!',
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('Error:', error);
      }
    }

    window.addEventListener('load', runExample);
  </script>
</body>
</html>
```

### Using Both Local and Remote Together

```javascript
// Local component communication
const local = new nooblyjsNotifying();

// Create a local event bus for component communication
await local.createTopic('app-events');
local.subscribe('app-events', (event) => {
  console.log('Component event:', event);
});

// Emit local event (instant delivery)
await local.notify('app-events', {
  type: 'user-selected',
  userId: 123
});

// Remote server messaging
const remote = new nooblyjsNotifying({ instanceName: 'production' });

// Create a server topic for distributed messaging
await remote.createTopic('user-events');
remote.subscribe('user-events', (event) => {
  console.log('Server event:', event);
});

// Send to server (reaches all connected clients)
await remote.notify('user-events', {
  type: 'user-logged-in',
  userId: 123
});
```

## API Reference

### Constructor

```javascript
new nooblyjsNotifying(config)
```

**Parameters:**
- `config.instanceName` (string, optional): Name of the notifying service instance. Default: `'default'`
- `config.baseUrl` (string, optional): Base URL for API calls. Default: `window.location.origin`
- `config.headers` (object, optional): Additional headers to include in requests. Default: `{}`

### Methods

#### `createTopic(topic)`
Creates a new notification topic.

**Parameters:**
- `topic` (string, required): The name of the topic to create

**Returns:** Promise<string>

**Example:**
```javascript
await notifying.createTopic('user-events');
```

---

#### `subscribe(topic, callback, options)`
Subscribes to a topic to receive notifications.

**Parameters:**
- `topic` (string, required): The topic name to subscribe to
- `callback` (function, required): Function called when a notification is received
- `options` (object, optional): Additional subscription options
  - `callbackUrl` (string): Custom callback URL for server-side webhooks
  - `pollingInterval` (number): Polling interval in milliseconds

**Returns:** Promise<Object> with `subscriptionId`, `topic`, and `status`

**Example:**
```javascript
const subscription = await notifying.subscribe('user-events', (message) => {
  console.log('New notification:', message);
});
```

---

#### `unsubscribe(topic, subscriptionId, options)`
Unsubscribes from a topic.

**Parameters:**
- `topic` (string, required): The topic name to unsubscribe from
- `subscriptionId` (string, optional): The subscription ID to remove. If not provided, all subscriptions for the topic are removed
- `options` (object, optional): Additional options
  - `callbackUrl` (string): Callback URL to unregister from server

**Returns:** Promise<string>

**Example:**
```javascript
await notifying.unsubscribe('user-events', subscriptionId);
```

---

#### `notify(topic, message)`
Publishes a notification to a topic.

**Parameters:**
- `topic` (string, required): The topic to publish to
- `message` (any, required): The message/payload to publish

**Returns:** Promise<string>

**Example:**
```javascript
await notifying.notify('user-events', {
  type: 'user-login',
  userId: '123'
});
```

---

#### `getStatus()`
Gets the service status.

**Returns:** Promise<string>

**Example:**
```javascript
const status = await notifying.getStatus();
console.log(status); // "notifying api running"
```

---

#### `getInstances()`
Gets a list of available instances.

**Returns:** Promise<Object> with `instances` array

**Example:**
```javascript
const { instances } = await notifying.getInstances();
console.log(instances); // ['default', 'production', ...]
```

---

#### `getSwaggerSpec()`
Gets the OpenAPI/Swagger specification for the API.

**Returns:** Promise<Object>

**Example:**
```javascript
const spec = await notifying.getSwaggerSpec();
console.log(spec.info.title); // "Notifying Service API"
```

---

#### `setPollingEnabled(enabled)`
Enable or disable polling for subscriptions.

**Parameters:**
- `enabled` (boolean): Whether polling should be enabled

**Example:**
```javascript
notifying.setPollingEnabled(false); // Reduce network traffic
```

---

#### `setPollingInterval(interval)`
Set the polling interval for all subscriptions.

**Parameters:**
- `interval` (number): Polling interval in milliseconds

**Example:**
```javascript
notifying.setPollingInterval(10000); // Poll every 10 seconds
```

---

#### `getSubscriptions()`
Get all active subscriptions.

**Returns:** Object with topics as keys and subscription IDs as values

**Example:**
```javascript
const subs = notifying.getSubscriptions();
// { 'user-events': ['sub-id-1', 'sub-id-2'] }
```

---

#### `disconnect()`
Clear all subscriptions and stop polling.

**Example:**
```javascript
notifying.disconnect();
```

---

#### `emitToSubscribers(topic, message)`
Manually trigger a notification to all subscribers (for testing, local service only).

**Parameters:**
- `topic` (string): The topic
- `message` (any): The message to emit

**Example:**
```javascript
const notifying = new nooblyjsNotifying();
notifying.emitToSubscribers('user-events', { test: true });
```

---

#### `getTopics()`
Get all topics (local service only).

**Returns:** Promise<Array>

**Example:**
```javascript
const local = new nooblyjsNotifying();
const topics = await local.getTopics();
console.log(topics); // ['topic1', 'topic2', ...]
```

---

#### `isLocalService()`
Check if this is a local or remote service instance.

**Returns:** boolean (true if local, false if remote)

**Example:**
```javascript
const local = new nooblyjsNotifying();
console.log(local.isLocalService()); // true

const remote = new nooblyjsNotifying({ instanceName: 'production' });
console.log(remote.isLocalService()); // false
```

## When to Use Local vs Remote

### Use Local Service When:
- ✅ You need instant, in-memory event communication
- ✅ Building component communication patterns
- ✅ You don't need persistence across page reloads
- ✅ You want zero network latency
- ✅ You're building a single-page application (SPA)
- ✅ You want to avoid server dependencies

### Use Remote Service When:
- ✅ You need distributed messaging across multiple clients
- ✅ You want persistent message storage on the server
- ✅ You need multi-instance scalability
- ✅ You require cross-page or cross-browser communication
- ✅ You want to broadcast to multiple users/tabs
- ✅ You need to survive page reloads

## Features

- **Dual-Mode**: Automatic switching between local and remote based on configuration
- **Lightweight**: Minimal dependencies, no external libraries required
- **Promise-based**: Modern async/await support
- **Multi-instance support**: Work with multiple remote service instances
- **Flexible subscriptions**: Local callbacks and server-side webhooks
- **Error handling**: Comprehensive error messages for debugging
- **Cross-origin**: CORS support for cross-domain requests
- **Testing friendly**: Built-in methods for testing subscriptions
- **Zero-Dependency Local Service**: No network calls required for local pub/sub

## Error Handling

The library throws descriptive errors that you should handle:

```javascript
try {
  await notifying.createTopic('my-topic');
  await notifying.subscribe('my-topic', (msg) => {
    console.log(msg);
  });
} catch (error) {
  console.error('Error:', error.message);
}
```

## Browser Support

The library works in all modern browsers that support:
- Promise
- Fetch API
- ES6 Classes

## Notes

- Subscriptions use polling by default (every 5 seconds)
- Adjust polling interval based on your needs
- Disable polling when not needed to reduce network traffic
- Call `disconnect()` when done to clean up resources
