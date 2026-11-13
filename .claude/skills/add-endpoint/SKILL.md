---
name: add-endpoint
description: Add or change a REST endpoint on a nooblyjs-core service — route in routes/index.js (default and :instanceName variants), auth, safe errors, Swagger docs.json, .http example and a test. Use whenever an API route under /services/{service}/api is added or modified.
argument-hint: "<service> <METHOD> <path> [purpose]"
---

# Add a REST endpoint

Endpoint: $ARGUMENTS

## Route (`src/{service}/routes/index.js`)

- Declare the route's permission in `src/authservice/config/routePermissions.js`: `'METHOD /services/{service}/api/...': '{service}:read'` (or `:write`, `settings:manage`, or `public` for an unauthenticated route). The `/:instanceName` variant shares the line. In production (strictAuth) an undeclared route fails start-up, and `tests/unit/security/generatedAuthMatrix.test.js` checks it.
- Implement the behaviour in the provider first; the route should only parse input, call the provider, and shape the response.
- Register under `/services/{service}/api/...`. The service's `app.use('/services/{service}/api', requireApiAuth)` guard already protects it — don't add endpoints outside that prefix without an auth decision. Paths ending in `/status` bypass the services login guard, so never put sensitive data behind such a path.
- If the service supports named instances, register both the default path and `/services/{service}/api/:instanceName/...`, resolving the instance with `getServiceInstance('{service}', req.params.instanceName, provider, options, providerType)` (`src/appservice/utils/routeUtils`). Register specific paths before parameterised ones so Express doesn't shadow them.
- Validate input and return `400` with `{ error: '...' }` for missing/invalid fields.
- Wrap handlers in `try/catch` and respond with `sendSafeError(res, err, { status, eventEmitter })` (`src/shared/utils/safeError`) — no raw error messages or stacks.
- Emit an event where the service does so for comparable endpoints (e.g. `api-{service}-...`).
- Add the JSDoc block above the route in the same style as its neighbours (`METHOD /path`, description, `@param` for params/body, `@return {void}`).

## Swagger (`src/{service}/routes/swagger/docs.json`)

- Add the path relative to the `servers` url (`/services/{service}/api`), with `tags`, `summary`, `description`, parameters, `requestBody` schema and responses (200/400/401/500).
- Keep it valid JSON: `node -e "require('./src/{service}/routes/swagger/docs.json')"`.

## Examples and tests

- Add a request to `tests/api/{service}/{service}.http` using the file's `@baseUrl` / `@apiKey` variables.
- Add a Jest route test: build an `express()` app with `express.json()`, create the service via its factory with `{ 'express-app': app, dependencies: {...} }`, and hit the endpoint with `supertest` (a dev dependency). Cover success, validation failure and provider error.
- Run the service's tests, then `npm test`. Any manual curl/HTTP runs and their output go in `.temp/tests/`.

If the endpoint is used by the dashboard or a client library in `src/{service}/scripts/`, update that caller too.
