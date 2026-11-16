# 04: Fetching

**Time:** about 15 minutes · **Example:** [`examples/04-fetching.js`](examples/04-fetching.js) · **Run:** `node .claude/learning/examples/04-fetching.js`

## What you will learn

Make outbound HTTP requests through the fetching service, why it refuses some addresses, and how responses are cached.

## Key ideas

- **Outbound requests go through one place.** Use the fetching service instead of calling `fetch` directly, so every request has the same safety checks, caching and analytics.
- **The SSRF guard.** Server-side requests are a common way to attack internal networks: a user supplies a URL, and the server fetches `http://169.254.169.254/` or `http://10.0.0.5/admin`. The guard refuses loopback, private and link-local addresses before connecting, and can be narrowed with an allow-list (`ssrf: { allowedHosts: [...] }`). The example shows the refusal.
- **A known gap: redirects (confirmed).** The guard checks only the address you pass in. The Node provider follows redirects by default, and the target of a redirect is not checked. With `allowedHosts: ['localhost']`, a request to `http://localhost:<port>/` that redirects to `http://127.0.0.1:<port>/` returns the private server's body, while a direct request to `127.0.0.1` is refused. Until this is fixed, do not fetch URLs whose redirects you do not control, and use `redirect: 'manual'` for those requests.
- **Cache only what is safe.** Only successful `GET` responses are cached. Requests with `cache: 'no-store'` and non-GET methods are never cached.
- **Cache lifetime.** `next: { revalidate: 60 }` keeps a response for 60 seconds. `cache: 'force-cache'` keeps it with no expiry, which in practice means until the process restarts.
- **Providers.** `node` uses Node's built-in `fetch`. `axios` uses Axios when it is installed. `default` is `node`.

## Walk-through

### Create the service

```javascript
const fetching = registry.fetching('node');
```

### A refused request

```javascript
try {
  await fetching.fetch('http://127.0.0.1:9/internal');
} catch (err) {
  console.log(err.message);   // Blocked request: host "127.0.0.1" resolves to a private/reserved address
}
```

The refusal happens before any connection is made. Your code gets an error it can show or log.

### A cached request

```javascript
const response = await fetching.fetch('https://example.com/', { next: { revalidate: 60 } });
await fetching.fetch('https://example.com/', { next: { revalidate: 60 } });  // from the cache
console.log(fetching.getAnalytics());
```

The second request is answered from the cache. `getAnalytics()` counts the operations, so you can see the hit rate.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/services/fetching/api/fetch` | Fetch a URL described in the body |
| GET | `/services/fetching/api/fetch/:url` | Fetch a URL given in the path (encode it) |
| GET | `/services/fetching/api/list` | Cached entries |
| DELETE | `/services/fetching/api/cache` | Clear the cache |
| GET | `/services/fetching/api/analytics` | Operation counts |
| GET/POST | `/services/fetching/api/settings` | Read or change settings |

## Providers

| Type | Library | Notes |
|---|---|---|
| `node` (default) | Node's built-in `fetch` | No extra dependency |
| `axios` | Axios | Needs `axios` installed in your app |

## Common mistakes

- **Fetching a URL a user typed.** Even with the guard, a user can point you at a public host that redirects to an internal address (see the known gap above). Allow-list the hosts you need with `ssrf: { allowedHosts }`.
- **Expecting POST responses to be cached.** They are not, by design.
- **Caching a response that changes per user.** A cached response is the same for everyone who asks for that URL. Do not cache responses that depend on the caller.
- **Forgetting that the example needs internet access.** Without it the public request fails with a network error. The example reports that and carries on.

## Try it

1. Fetch a URL twice with `revalidate: 1`, wait two seconds, and fetch it again. Check the analytics between the calls.
2. Try `http://localhost:9000/` and read the error message. Then give the fetching service an `ssrf` option with `allowedHosts: ['example.com']` and explain what changes for `https://example.com/`.
3. Fetch with `cache: 'no-store'` and check that the cache count does not change.
