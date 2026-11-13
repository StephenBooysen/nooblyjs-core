---
name: new-service
description: Scaffold a new nooblyjs-core service — factory, default and API providers, analytics module, routes with Swagger, dashboard view, registry wiring, navigation entry and tests. Use when the user wants a new top-level service under src/.
argument-hint: "<serviceName> [dependencies]"
---

# Scaffold a new service

Service: $ARGUMENTS

First confirm the capability doesn't belong in an existing service. Pick the service name (lowercase, one word, matches the folder and URL: `/services/{name}/`) and its dependencies.

Use `src/notifying/` as the reference implementation — it is small and has every piece. Mirror its structure, headers and JSDoc style.

## Files to create

```
src/{name}/
  index.js                 # factory (type, options, eventEmitter)
  providers/{name}.js      # default in-memory provider
  providers/{name}Api.js   # remote proxy provider (axios, options.apiRoot / options.apiKey → X-API-Key)
  modules/analytics.js     # constructed as new Analytics(eventEmitter, provider, instanceName)
  routes/index.js          # Express routes
  routes/swagger/docs.json # OpenAPI 3.0, servers: [{ url: "/services/{name}/api" }]
  views/index.js           # serves views/index.html at /services/{name} and /services/{name}/
  views/index.html         # dashboard (copy the header/nav/layout of src/notifying/views/index.html)
```

### Factory (`index.js`)
- `switch (type)` over provider names; `default:` falls back to the in-memory provider. Throw for unknown types only if the service has no sensible default.
- Build analytics with the instance name (`options.instanceName || 'default'`), then call `Routes(options, eventEmitter, provider, analytics)` and `Views(options, eventEmitter, provider)`.
- Return the provider instance.

### Provider
- Constructor `(options = {}, eventEmitter)`: store `instanceName_`, take `this.logger = options.dependencies?.logging || null`, and define `this.settings = { description, list: [{ setting, type, values }] , ...defaults }`.
- Implement `async getSettings()` / `async saveSettings(settings)` following `src/notifying/providers/notifying.js`.
- Emit events for major operations; log through `this.logger?.`.

### Routes (`routes/index.js`)
- Guard with `if (options['express-app'] && provider)`.
- Declare every route's permission in `src/authservice/config/routePermissions.js` (`'METHOD /services/{name}/api/...': '{name}:read'` or `:write`). Without it, start-up fails in production (strictAuth).
- Mount auth once: `app.use('/services/{name}/api', options.authMiddleware || ((req, res, next) => next()))`.
- Always provide: `GET /api/status` (unauthenticated by the services guard because it ends in `/status`), `GET/POST /api/settings`, `GET /api/instances`, `GET /api/swagger/docs.json`, and analytics endpoints.
- For each operation register both `/services/{name}/api/...` and `/services/{name}/api/:instanceName/...`, resolving the instance with `getServiceInstance('{name}', instanceName, provider, options, providerType)` from `src/appservice/utils/routeUtils`.
- Errors: `sendSafeError(res, err, { status, eventEmitter })` from `src/shared/utils/safeError` — never return raw `err.message` / stacks.

## Wiring

1. `index.js` (ServiceRegistry):
   - add the dependency list in `initializeServiceDependencies()` at the right level,
   - add the default provider to `getDefaultProviderType()`,
   - add a factory method with JSDoc, e.g. `{name}(providerType = 'memory', options = {}) { return this.getService('{name}', providerType, options); }`.
2. `src/views/js/navigation.js`: add `{ name, icon: 'bi-…', title, path, classification }` to `services` (classification: foundation / business / application / advanced to match its level).
3. `app.js` and `app-noauth.js`: create the service alongside the others.
4. `CLAUDE.md`: add it to the dependency table and provider notes.

## Tests and examples

- `tests/unit/{name}/{name}.test.js` (see the `write-tests` skill), including a routes test if routes have logic.
- `tests/api/{name}/{name}.http` with `@baseUrl` / `@apiKey` variables, mirroring `tests/api/notifying/notifying.http`.
- Optionally `tests/app/{name}/app-{name}.js` as a standalone demo app.

Run `npm test`, then start `npm run dev:noauth` and check `/services/{name}/` and `/services/{name}/api/status` load. Save any manual verification output in `.temp/tests/`, and write a summary to `.temp/updates/`.
