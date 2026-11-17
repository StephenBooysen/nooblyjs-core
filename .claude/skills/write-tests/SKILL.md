---
type: Skill
name: write-tests
description: Write or extend Jest unit tests for nooblyjs-core services following the repo's patterns (factory creation, mocked dependencies, EventEmitter spies, cleanup), then run them. Use when adding coverage for a service, provider, route or bug fix.
argument-hint: "<service or file to test>"
---

# Write tests

Target: $ARGUMENTS

## Where

- Permanent tests: `tests/unit/{service}/*.test.js` (Jest only discovers `*.test.js`). Files named `*.disabled.js` / `*.disable.js` are intentionally excluded — don't rename them to enable without the backing service.
- Ad-hoc or exploratory scripts and their output: `.temp/tests/`, not `tests/`.

## Pattern

```javascript
'use strict';

const createService = require('../../../src/{service}');
const EventEmitter = require('events');

describe('{Service} ({provider})', () => {
  let service;
  let eventEmitter;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  beforeEach(() => {
    eventEmitter = new EventEmitter();
    jest.spyOn(eventEmitter, 'emit');
    service = createService('{provider}', { dependencies: { logging: logger } }, eventEmitter);
  });

  afterEach(async () => {
    await service.close?.();      // or stop timers / disconnect
    jest.clearAllMocks();
  });

  it('does the thing', async () => {
    const result = await service.doThing('x');
    expect(result).toEqual(/* ... */);
    expect(eventEmitter.emit).toHaveBeenCalledWith('{event}', expect.objectContaining({ /* ... */ }));
  });
});
```

- Create services through the factory (not `new Provider`) unless testing a provider in isolation; with no `express-app` option the factory skips route/view registration.
- Inject dependencies as mocks via `options.dependencies`. Don't go through the `ServiceRegistry` singleton unless testing the registry itself; if you do, call `serviceRegistry.reset()` in `afterEach`.
- Mock external SDKs/clients with `jest.mock()`; never require a real Redis/Mongo/cloud service. Gate real-backend tests behind an env var (see `RUN_MONGODB_TESTS`).
- File providers and other tests that write to disk use `testDataDir()` from `tests/helpers/testData.js`, which places data under `.temp/tests/data/` (e.g. `fs.mkdtempSync(path.join(testDataDir(), 'nooblyjs-...'))`; see `.claude/rules/output-locations.md`). Remove temp dirs in `afterEach`/`afterAll`, and always pass a `logDir`/`dataDir`/`baseDir` so nothing lands in the repo root.
- Use `jest.useFakeTimers()` for schedulers, TTLs and polling; restore real timers afterwards.
- Jest runs with `detectOpenHandles` and `forceExit`: clear intervals, close servers and connections so tests don't hang or leak.

## What to cover

Happy path, invalid input (expect rejections with `await expect(...).rejects.toThrow(...)`), emitted events, settings `getSettings`/`saveSettings`, and multi-instance isolation (`instanceName`) where relevant. For a bug fix, write the failing test first.

## UI tests (Playwright)

For dashboard/client UI behaviour, write a spec in `tests/ui/{service}.spec.js` using `@playwright/test` (see `tests/ui/smoke.spec.js`): navigate with relative URLs (`page.goto('/services/{service}/')` — the base URL and server come from `playwright.config.js`), prefer role/text locators (`page.getByRole('button', { name: 'Run now' })`) over CSS classes, and assert no `pageerror` events. The server runs `app-noauth.js` with in-memory providers, so create any data the test needs through the service's API (`request.post('/services/{service}/api/...')`) rather than relying on existing state. Run with `npm run test:ui` (or `-- --project=chromium tests/ui/{file}` while iterating).

## Run

- One file: `npm test -- tests/unit/{service}/{file}.test.js`; one case: `npm test -- -t "name"`.
- Then the full suite: `npm test`. Report the pass/fail counts; include failure output if anything fails.
