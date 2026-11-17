---
type: Learning Guide
title: '18: AppService'
description: 'Build your own application on top of NooblyJS: routes, services, data access and background work, using the base classes the appservice service provides and the services you have already learned.'
---

# 18: AppService

**Time:** about 20 minutes · **Example:** [`examples/18-appservice.js`](examples/18-appservice.js) · **Run:** `node .claude/learning/examples/18-appservice.js`

## What you will learn

Build your own application on top of NooblyJS: routes, services, data access and background work, using the base classes the appservice service provides and the services you have already learned.

## Key ideas

- **Base classes, not a framework.** The appservice service gives you five base classes: `appViewBase`, `appRouteBase`, `appWorkerBase`, `appServiceBase` and `appDataBase`. You extend them in your own code.
- **Routes register on the shared Express app.** `appRouteBase` sets `this.app` (the Express app) and `this.baseUrl` (ending in `/`). Your constructor calls a setup method that adds the routes.
- **Dependencies are passed in.** Services you need (logging, caching, queueing) are created with the registry and handed to your classes. Keep a reference and use it.
- **Options are kept.** The options you pass to a base class are kept in `this.options`.
- **A standard folder layout.** Given a root folder, the factory can scan `src/routes`, `src/services`, `src/data`, `src/views` and `src/activities`, so each kind of code has a known place.

## Walk-through

### Create the kit

```javascript
const kit = registry.appservice('default', {
  name: 'Orders',
  baseUrl: '/orders',
  'express-app': app,
  dependencies: { logging: registry.logger('memory'), cache: registry.cache('memory') },
}, eventEmitter);
```

`kit` holds the base classes. `Object.keys(kit)` lists them.

### A route class

```javascript
class OrderRoutes extends kit.appRouteBase {
  constructor(type, options, emitter) {
    super(type, options, emitter);
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.get(this.baseUrl + 'status', (req, res) => res.json({ ok: true }));
    this.app.get(this.baseUrl + ':id', async (req, res) => { /* ... */ });
  }
}

new OrderRoutes('orders-routes', { 'express-app': app, baseUrl: '/orders' }, eventEmitter);
```

Creating the instance is enough: the routes are on the app from that point.

### Pass dependencies in

The example reads the cache from a `const cache` in scope. The base class does not provide a `this.dependencies` object, so either pass the services into your constructor and store them on `this`, or close over them as the example does.

## Over REST

Routes are whatever your classes add. The appservice service has no REST API of its own.

## Providers

| Type | Notes |
|---|---|
| `default` | The base classes, for your own app code |

## Common mistakes

- **Forgetting the trailing slash.** `this.baseUrl` ends with `/`, so write `this.baseUrl + 'status'`, not `this.baseUrl + '/status'`. A double slash does not match the route.
- **Registering routes after the server starts.** Express matches routes in the order they are added, and a catch-all added first hides the rest. Register your routes before the not-found handler.
- **Leaving a custom route open by accident.** Nothing protects `/orders` unless you add the check yourself. Use the auth service's session or API key checks in your route, and do not assume the service's permission table covers your paths.
- **Doing slow work in the route.** Use the working or scheduling services (tutorials 10 and 11), or enqueue a job (tutorial 03).
- **Putting data access in routes.** Keep it in a service or data class, so routes stay thin and the data layer can be tested alone.

## Try it

1. Add a `POST /orders` route that stores an order in the cache and returns its id.
2. Add a data class with `find` and `save` methods, and have the route use it.
3. Request `/orders/status` without an API key, then with one, and explain why the two answers differ, or do not, given your route's checks.
