---
type: Learning Guide
title: '02: Caching'
description: Store values by key, read them back, delete them, and keep separate caches for different purposes with named instances.
---

# 02: Caching

**Time:** about 15 minutes · **Example:** [`examples/02-caching.js`](examples/02-caching.js) · **Run:** `node .claude/learning/examples/02-caching.js`

## What you will learn

Store values by key, read them back, delete them, and keep separate caches for different purposes with named instances.

## Key ideas

- **A cache is key and value.** `put(key, value)`, `get(key)`, `delete(key)`. Values are any JSON-friendly data.
- **A miss is `undefined`.** `get` returns `undefined` for a key that is not there, or has expired, so check for it before using the value.
- **Providers decide where the data lives.** `memory` is per process. `redis` is shared by every instance of your app. The methods are the same, so the code does not change when you switch.
- **Named instances.** `registry.cache('memory', { instanceName: 'sessions' })` is a separate cache from the default one, even with the same provider. Use one per purpose so keys do not collide.
- **Analytics.** Every cache counts its operations. `getAnalytics()` returns the counts, and the dashboard shows them.

## Walk-through

### Put, get and delete

```javascript
const cache = registry.cache('memory');

await cache.put('greeting', { text: 'hello' });
console.log(await cache.get('greeting'));   // { text: 'hello' }

await cache.delete('greeting');
console.log(await cache.get('greeting'));   // undefined
```

### Use it over REST

```javascript
await call('POST', '/services/caching/api/put/visits', { value: 41 });
const got = await call('GET', '/services/caching/api/get/visits');
// got.body => { value: 41 }
```

The key is in the path. The value is the `value` field of the body.

### Separate instances

```javascript
const sessions = registry.cache('memory', { instanceName: 'sessions' });
await sessions.put('user:ada', { role: 'admin' });
await cache.get('user:ada');   // undefined: the default instance does not see it
```

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/caching/api/put/:key` | Store `{ value }` under the key |
| GET | `/services/caching/api/get/:key` | Read the value |
| DELETE | `/services/caching/api/delete/:key` | Remove the key |
| GET | `/services/caching/api/list` | List keys |
| GET | `/services/caching/api/analytics` | Operation counts |
| GET | `/services/caching/api/instances` | Instances that exist |

Named instances put the instance name before the action, for example `/services/caching/api/sessions/get/:key`.

## Providers

| Type | Shared across instances | Needs |
|---|---|---|
| `memory` | No | Nothing (the default) |
| `redis` | Yes | The host in `redisurl` (default `127.0.0.1`; the port is fixed at 6379) |
| `memcached` | Yes | A Memcached server |
| `file` | Per machine | A folder |
| `api` | Yes, through a remote cache | The remote URL |
| `aws`, `azure`, `gcp` | Yes | The cloud provider's settings |

The Redis cache reads its host from the `redisurl` option, not from `REDIS_URL`. The session store reads `SESSION_REDIS_URL` or `REDIS_URL`. Note that `nooblyjs doctor` checks `REDIS_URL` for the cache and queue, which these providers do not read: pass the host to the factory.

```javascript
const cache = registry.cache('redis', { redisurl: '10.0.0.12' });
```

## Common mistakes

- **Expecting the cache to hold data forever.** Memory caches evict the least recently used entries when they are full. Treat a cache as a copy: the source of truth stays in the data service.
- **Sharing one instance for unrelated data.** Keys from two features can overwrite each other. Give each feature its own instance name.
- **Using `memory` in a cluster.** Each process has its own copy, so one instance can see stale data another has changed. Use `redis` when you run more than one process.
- **Storing values that do not survive JSON.** The Redis and file caches store values as JSON. Functions are dropped, and a `Date` comes back as a string, so convert dates yourself when you read them.

## Try it

1. Put a value, then read it through REST. Delete it through REST, then read it again.
2. Create a third instance called `reports` and show that `sessions` cannot see its values.
3. Call `cache.getAnalytics()` after a few operations. Which counts went up?
