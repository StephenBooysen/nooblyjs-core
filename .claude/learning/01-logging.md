# 01: Logging

**Time:** about 15 minutes · **Example:** [`examples/01-logging.js`](examples/01-logging.js) · **Run:** `node .claude/learning/examples/01-logging.js`

## What you will learn

Write structured log entries from your code, read them back over REST, and choose a logging backend.

## Key ideas

- **Logging is the foundation.** Every other service takes a logger, so logs from caching, queueing and the rest end up in the same place.
- **Messages carry details as an object.** `logger.info('Order received', { orderId: 'ord-1001' })` keeps the message readable and the details searchable. Avoid building the whole line as one string.
- **Four levels.** `debug`, `info`, `warn` and `error`. The level set in settings decides which ones are written.
- **Providers.** `memory` keeps entries in the process (the default for development). `file` writes them to a folder, `.temp/logs` by default. `api` sends them to a remote logging service.

## Walk-through

### Create the logger

```javascript
const logger = registry.logger('memory');
```

Creating the service also mounts its REST routes under `/services/logging/api`.

### Write entries

```javascript
logger.info('Order received', { orderId: 'ord-1001', amount: 49.99 });
logger.warn('Payment slow', { orderId: 'ord-1001', seconds: 12 });
logger.error('Payment failed', { orderId: 'ord-1002', code: 'CARD_DECLINED' });
```

Each entry is stored as a line with a timestamp, the level, the app name and your message, followed by the details. The example prints the newest entry back.

### Read entries back

```javascript
const logs = await call('GET', '/services/logging/api/logs');
console.log(logs.body.count, logs.body.logs[logs.body.logs.length - 1]);
```

`call` is a helper in [`setup.js`](examples/setup.js) that sends a request to the example server with the learning API key. In your own app you would use `fetch` or curl with the same header.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| GET | `/services/logging/api/status` | Is the service running |
| POST | `/services/logging/api/info` | Write an info entry (`message`, `meta`) |
| POST | `/services/logging/api/warn` | Write a warning |
| POST | `/services/logging/api/error` | Write an error |
| GET | `/services/logging/api/logs` | Recent entries (`count`, `logs`) |
| GET | `/services/logging/api/stats` | Counts by level |
| GET | `/services/logging/api/timeline` | Entries over time |
| GET/POST | `/services/logging/api/settings` | Read or change level and output |

Named instances use the same paths with the instance name after `/api/`, for example `/services/logging/api/{instanceName}/logs`.

## Providers

| Type | Stores entries | Use it for |
|---|---|---|
| `memory` | In the process, lost on restart | Development, tests, examples |
| `file` | Files under `logDir` (default `.temp/logs`) | Single-server apps |
| `api` | A remote logging service | Central logs for several apps |

## Common mistakes

- **Logging secrets.** A `meta` object is stored as given. Never put passwords, tokens or card numbers in it.
- **Using `console.log` in server code.** Those lines do not reach the logging service, so they cannot be searched or shown on the dashboard. Use the injected logger.
- **Assuming `memory` survives a restart.** Use `file` or `api` for logs you need to keep.
- **Giving services no logger.** Services work without one, but they stay silent. Create the logger first and pass it as a dependency; the registry does this when you create a service through it.

## Try it

1. Change the example to log at `debug` level and check whether it appears. Then change the logging settings (`POST /services/logging/api/settings`) and try again.
2. Write an entry over REST with `meta` set to a nested object. Read it back and find the nested field.
3. Create a second logger with `registry.logger('file', { logDir: '.temp/learning/logs-01' })`. Check the folder for a file.
