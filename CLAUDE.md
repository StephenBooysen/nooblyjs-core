# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hosting NooblyJS AI apps

nooblyjs-core is also the shared library under the NooblyJS AI host (`../nooblyjs-ai/nooblyjs-ai-host`). The parts it relies on:

- `public/ui/`: the UI kit and the one frame every hosted app is drawn into (served at `/ui/` by the host): tokens, base, components and shell CSS, `frame.html`, and ES modules (`html`, `icons`, `api`, `router`, `sse`, `chat`, `components/`). Figtree, Bricolage Grotesque and JetBrains Mono are self-hosted (SIL OFL, licences in `public/ui/fonts/`).
- `src/shell/`: `createShell()` (rail, sidebar, status cards, the frame page handler) and `css-scope.js`; `scripts/scope-css.js` scopes an app's stylesheet under `[data-module="<name>"]`.
- `src/store/fs-store.js`: FsStore, the files-only store (Markdown with YAML front matter, YAML config, atomic tmp+rename writes, per-path locks, path-segment validation).
- `src/shared/utils/routePattern.js`: `route()` turns an Express 4 pattern (`*`, `:name(*)`, `:opt?`) into patterns Express 4 and 5 both accept. Use it for any route with a wildcard or optional parameter, so the registry can mount on an Express 5 app.
- `src/aiservice/common/`: the AI module, an ESM package named `nooblyjs-ai-common` (its own `package.json`) inside this CommonJS repo: one way to call every model provider (Anthropic, OpenAI, OpenAI-compatible, mock, AWS Bedrock, Google Vertex AI, Azure), the model catalogue and discovery, tokens, cost, retry, SSE. Projects link it as `file:<path to nooblyjs-core>/src/aiservice/common`. Its tests are `node:test` in `tests/unit/aiservice/common` (`npm run test:ai-common`; Jest skips them), and `npm run check:ai-common` type-checks it. It has no dependencies: keep it that way.
- `src/authservice/modules/redirect.js`: `safeReturnUrl()` and `postLoginRedirect()`: after sign-in a person goes to the page they were heading to (same-origin paths only), then the app's `loginSuccessRedirectUrl`, then `/services`.

## Project Overview

NooblyJS Core is a modular Node.js backend framework: a set of services (logging, caching, queueing, data, workflow, AI, auth, …) each with pluggable providers, created and wired together by a singleton `ServiceRegistry` exported from `index.js`. Each service also mounts a REST API and a dashboard UI under `/services/{serviceName}/`.

## Commands

- `npm run dev` — dev server with nodemon (watches `./src`, runs `app.js`, port `9000` or `$PORT`)
- `npm run dev:noauth` — same, using `app-noauth.js` (no login required; handy for UI work)
- `npm start` — `node ./app.js`
- `npm test` (alias `npm run tests`) — all Jest tests; `npm run coverage` adds coverage with the enforced threshold (as CI does)
- `npm test -- tests/unit/caching/cache.test.js` — a single file; `npm test -- -t "name"` for a single test
- `npm run test:ui` — Playwright UI tests in `tests/ui/` (desktop + mobile Chromium); `npm run test:ui -- --project=chromium tests/ui/smoke.spec.js` for one file/project, `npm run test:ui:headed` to watch, `npm run test:ui:report` to open the HTML report
- `npm run kill` / `npm run kill-test` — free port 9000 / 3101 when a server hangs
- `npm run certs` / `npm run certs:force` — generate self-signed TLS certs for local HTTPS
- `npm run build` — `scripts/build.js`

There is no linter. Jest runs with `forceExit` and `detectOpenHandles`; tests must clean up timers/handles in `afterEach`/`afterAll`. Tests that write to disk get their directory from `tests/helpers/testData.js` (`testDataDir()` → `.temp/tests/data/`); the file logger defaults to `.temp/logs/`. Nothing a test run creates should appear outside `.temp/` (see `.claude/rules/output-locations.md`).

Skipped by default: MongoDB/DocumentDB suites (need `RUN_MONGODB_TESTS=1` / `RUN_DOCUMENTDB_TESTS=1` and a live DB), TensorFlow (needs optional `@tensorflow/tfjs-node`), SimpleDB (needs optional `aws-sdk` v2). Files named `*.disabled.js` / `*.disable.js` (Redis, Memcached, S3, filing, API-key integration) are not picked up by Jest.

UI tests (`playwright.config.js`): Playwright starts `app-noauth.js` itself on port `11100` (`UI_TEST_PORT`) with `ALLOW_NOAUTH=1` — `app-noauth.js` refuses to start without that flag. Set `UI_TEST_BASE_URL` to test an already-running server instead. Results, traces, screenshots and the HTML report go to `.temp/tests/playwright/`. Jest ignores `tests/ui/` and `.temp/` (`testPathIgnorePatterns`), so Playwright specs must stay in `tests/ui/`. After `npm install` on a new machine, run `npx playwright install --with-deps chromium`. Note the AI dashboard is at `/services/ai`, not `/services/aiservice`.

`tests/app/{service}/app-*.js` are standalone apps showing one service with a specific provider — run directly with `node`.

## Architecture

### ServiceRegistry (`index.js`)

- `initialize(expressApp, eventEmitter, globalOptions)` must be called first. It sets up API-key middleware (`security.apiKeyAuth`: `apiKeys`, `requireApiKey`, `excludePaths`) and services login (`security.servicesAuth.requireLogin`, default true — `/services/*` needs an authenticated `admin` session), plus the monitoring endpoints `/services/api/monitoring/{metrics,snapshot}`.
- `getService(serviceName, providerType, options)` is the core: it resolves dependencies recursively, injects them as `options.dependencies`, and caches instances keyed by service + provider + `options.instanceName` (default `'default'`). Convenience factories wrap it: `logger()`, `cache()`, `queue()`, `dataService()`, `filing()`, `settings()`, `workflow()`, `aiservice()`, etc.
- Injected dependencies use `getDefaultProviderType()` (built-in defaults: mostly `memory`; `filing`→`local`, `authservice`/`settings`→`file`, `aiservice`→`claude`, `fetching`→`node`), not the provider of the service being created. To inject e.g. a Redis queue everywhere, call `setDefaultProvider('queueing', 'redis', options)` **before** creating anything that depends on it — resolved dependencies are cached.
- `shutdown()`, `reset()`, `resetService()` exist for teardown in tests.

The dependency graph is hard-coded in `initializeServiceDependencies()` (the source of truth — update it when adding a service):

| Level | Service → dependencies |
|---|---|
| 0 | `logging` |
| 1 | `caching`, `queueing`, `notifying`, `appservice`, `fetching`, `settings` → logging |
| 2 | `dataservice` → logging, queueing · `working`, `measuring` → logging, queueing, caching |
| 3 | `scheduling` → logging, working · `searching` → logging · `workflow` → logging, queueing, scheduling, measuring, working · `filing` → logging, queueing, dataservice |
| 4 | `authservice` → logging, caching, dataservice · `aiservice` → logging, caching, workflow, queueing |

### Service layout

Each `src/{service}/index.js` is a factory `(providerType, options, eventEmitter)` that `switch`es on provider type, instantiates from `providers/` (`provider/` in aiservice and partly measuring), then registers `routes/index.js` (Express, with a Swagger doc under `routes/swagger/`) and `views/` (dashboard). Most services include a `modules/analytics.js` and an `*Api.js` provider that proxies to a remote instance of the same service. Check the factory's `case` labels for valid provider names — e.g. fetching is `node`/`axios`, measuring/notifying/working use `default`, settings is `file`/`encrypted`, filing adds `gcp`/`api`/`sync`, queueing adds `activemq`, aiservice includes `gemini`/`openai-kv`/`tensorflow`, authservice includes `azure`/`secure-email`.

Other shared code: `src/appservice/baseClasses/` (base classes for custom app services), `src/middleware/` (error handler, health checks), `src/shared/utils/` (`createServer`, `safeError`, `trustSystemCa`, plus `httpErrors`, `validation`, `sessionStore`, `contentSecurityPolicy` described under Conventions), `src/views/` (the top-level services dashboard and `modules/monitoring.js`), `public/` (static site).

### Services with notable internals

**Settings** — grouped key/value settings in an AES-256-GCM encrypted JSON file; master secret from `options.secret`, `SETTINGS_SECRET` or `SESSION_SECRET`. Embeddable UI: `/services/settings/scripts/js/index.js` → `new SettingsUIManager({ containerId }).initialize()` (options: `groups`, `readOnly`, `allowGroupManagement`, `allowReveal`, `apiBaseUrl`, `fetchOptions`, `onChange`, `onError`).

**Workflow** — the memory provider keeps definitions, stars, schedules and execution history in memory (`containers/`) and schedules its own runs (`modules/workflowScheduler.js`, reusing scheduling's `cronExpression`). It never touches the filesystem: the host app persists by listening for `workflow:state:changed` and saving `workflow.exportState()`, and restores with the `state` option or `importState(snapshot)`. On import, running runs become interrupted failures and overdue enabled schedules are caught up once (`scheduleCatchUp`, `catchUpGraceMs`, `catchUpStaggerMs`). History is capped per workflow (`maxExecutionsPerWorkflow`, default 1000). Workflows are identified by name. Manager REST API in `routes/manager.js` (`/services/workflow/api/{workflows,runs,schedules,cron/preview,state}`); legacy `definitions`/`executions` endpoints are unchanged. UI: `WorkflowManagerUI` in `scripts/js/index.js` (screens `workflows`, `schedules`, `executions`; options `apiBaseUrl`, `fetchOptions`, `screens`, `initialScreen`, `readOnly`, `pollInterval`, `storageKey`, `onNavigate`, `onError`).

**Scheduling** — `providers/scheduling.js` supports `pause`/`resume` (paused cron minutes are not replayed), `update(name, changes)` (can switch cron ↔ interval, keeps callback and history), `listRuns`/`getRun` (last 50 runs per task, including fires skipped at the concurrency cap), `getStats`, and `start(..., { paused, runImmediately, description, group })`. `providers/cronExpression.js` `nextMatch()` is shared with workflow. Manager routes in `routes/manager.js` (`/services/scheduling/api/{tasks,runs,cron/preview}`). UI: `ScheduleManagerUI` in `scripts/js/index.js` (screens `schedules`, `runs`; same options as `WorkflowManagerUI`).

The workflow, scheduling and settings client UIs inject their own namespaced styles (`njsc-` for scheduling, so it can coexist with the workflow manager on one page), resolve colours against the host's NooblyJS design tokens (`--ink`, `--accent`, …) with fallbacks, have no framework dependency, and must work at phone width.

**Searching** — client library `src/searching/scripts/js/index.js` supports remote (`new searchService({ provider: 'remote' })`) or in-browser search; the UI tab emits `searchUIResults` / `searchUIResultSelected` custom events.

## Conventions

- **Errors to clients:** never send `err.message` for server faults. Throw `ClientError(status, message)` (`src/shared/utils/httpErrors.js`) for client-safe 4xx errors and respond with `sendSafeError(res, err, { status: 500, eventEmitter })` or `toClientResponse(err)`. `sendSafeError` lets a `ClientError` override the default status and maps ENOENT/NoSuchKey to 404. The SSRF guard and filing `pathSafety` throw `ClientError(400)`.
- **Input:** validate route input with `validate({ body, query, params })` and cap list sizes with `parseLimit` / `capLimit` / `parseOffset` (`src/shared/utils/validation.js`). Filing uploads go through `createUploadMiddleware` / `limitStream` (`src/filing/modules/uploadLimits.js`), which enforce `maxFileSize` / `allowedTypes`.
- **Security boundaries (Phase 0, 2026-11-12):** filing route tiers live in `src/filing/modules/access.js` (read / write / admin; add new filing routes to its route-word sets), runtime settings go through `src/filing/modules/settingsGuard.js` (only keys in a provider's `settings.list`; never the storage root), and downloads through `src/filing/modules/contentServing.js` (active types are always opaque attachments). Anything that runs a script resolves it with `src/working/modules/activityPath.js`: `assertActivityReference()` at the HTTP layer, `resolveActivityScript()` at execution. Invitations default to `admin-approval` and store only code hashes. `tests/unit/security/exploitChain.test.js` guards all of this.
- **Permissions (feature 19):** every `/services/*/api` route needs a rule in `src/authservice/policy/routePermissions.js` (a new service needs an entry in `SERVICE_AREAS`). `createPermissionMiddleware` (`src/authservice/middleware/permission.js`) is mounted on `/services` by `initialize()` and authenticates on its own, ignoring `excludePaths`. Role grants live in `src/authservice/modules/permissions.js`. `serviceRegistry.verifyRoutePermissions()` lists undeclared routes and throws in strict mode; `tests/unit/security/routePermissions.test.js` covers it.
- **Listeners:** a factory whose analytics subscribes to the shared emitter must set `service.analytics = analytics`, so `ServiceRegistry` can call `analytics.destroy()` on reset/shutdown (`tests/unit/registryListenerLeak.test.js` guards this).
- **Styling:** every page loads Bootstrap 5.3 and Bootstrap Icons from jsDelivr, then `/services/css/styles.css` (the NooblyJS design system, a verbatim copy of `nooblyjs/styling/styles.css` — re-copy it to update, never edit it here), then `/services/css/core.css` (core-only rules: Bootstrap variables mapped to the design tokens, styles.css ↔ Bootstrap fixes, the app chrome, service widgets, auth pages). Both live in `src/views/css/`. Write markup with Bootstrap classes (`card`/`card-header`/`card-body`, `btn btn-primary`, `form-control`, `table`, `nav-tabs`, `badge`); add a `core-*` class to `core.css` only when Bootstrap has nothing suitable. Colours come from the tokens (`var(--accent)`, `var(--ink)`, `var(--muted)`, `var(--border)`, `var(--core-success)`, …), not hex values. Feedback alerts use `alert … fade` and are shown by adding `show`.
- **CSP:** `app.js` / `app-noauth.js` enforce the policy in `src/shared/utils/contentSecurityPolicy.js`. A new external script/style/font origin must be added there, or the Playwright smoke test fails on the CSP violation.
- Server-side logging goes through the injected logger with optional chaining and structured metadata: `this.logger?.info(\`[${this.constructor.name}] ...\`, { ... })`. The migration off `console.*` is incomplete (some cloud providers, `*Api.js` providers, `createServer.js`, `errorHandler.js` still use it); browser scripts under `src/*/scripts/` and `src/*/views/` use `console` by design.
- `const`/`let`, `async/await`, and JSDoc (`@param`, `@return`, `@throws`, `@example`) on public methods and route factories, matching existing files.
- Services emit events on the shared EventEmitter for major operations; tests verify with `jest.spyOn(eventEmitter, 'emit')` and inject mock dependencies via `options.dependencies`.
- Commits use conventional format scoped by service, e.g. `fix(dataservice): ...`, `feat(workflow): ...`.

## Configuration

`.env` (not tracked): `PORT`, `API_KEYS` or `NOOBLYJS_API_KEYS` (comma-separated; in development one is generated and logged if none are set), `SESSION_SECRET`, `SETTINGS_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. Runtime data and logs go to `./.application/` (created automatically); filing uploads go to `FILING_BASE_DIR` (default `./.application/files`, never the app root). Production settings: `TRUST_PROXY` (behind a TLS-terminating proxy, otherwise Secure session cookies are never sent), `SESSION_REDIS_URL` / `REDIS_URL` (shared session store; otherwise a pruning in-process store), `CSP_MODE` (`enforce` / `report-only` / `off`), `CORS_ORIGINS`, `BODY_LIMIT`. `.env.example` lists every variable. `app.js` wires every service with file-based providers and is the reference for service setup.

**Deployment and CI:** `Dockerfile` builds a `node:24-alpine` image with `NODE_ENV=production`, a `HEALTHCHECK` on `/health/live`, a non-root user and a `.application` volume. It refuses to start without `SESSION_SECRET` and API keys. `.github/workflows/ci.yml` runs `npm run coverage` (Jest with a ratcheting `coverageThreshold`; reports in `.temp/coverage`) on Node 22 and 24, then `npm run test:ui`, `npm audit --omit=dev --audit-level=high` and a Docker build and boot check. Production-readiness reviews and the remediation tracker live in `.claude/steering/go-to-market/`. Product and architecture steering docs (`Application Architecture.md`, `Product Requirements.md`, the usage guides, `product/`, `features/`) live in `.claude/steering/`.
