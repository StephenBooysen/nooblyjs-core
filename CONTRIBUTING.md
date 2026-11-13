# Contributing to NooblyJS Core

Thanks for helping improve NooblyJS Core.

## Getting started

```bash
git clone https://github.com/nooblyjs/nooblyjs-core.git
cd nooblyjs-core
npm install
npx playwright install --with-deps chromium   # for UI tests
cp .env.example .env
npm run dev          # http://localhost:9000
```

## Before opening a pull request

```bash
npm run coverage     # Jest with the enforced coverage threshold
npm run test:ui      # Playwright UI checks (desktop + mobile)
npm audit --omit=dev --audit-level=high
```

CI runs the same checks on every pull request.

## Conventions

- **Structure:** each service lives in `src/{service}/` with a factory (`index.js`),
  `providers/`, `routes/` (plus a Swagger `routes/swagger/docs.json`), `views/` and
  `modules/analytics.js`. Register new services in `index.js` and its dependency graph.
- **Permissions:** every new `/services/{service}/api` route gets a line in `src/authservice/config/routePermissions.js`. Start-up fails in production without it.
- **Code style:** `const`/`let`, `async/await`, JSDoc on public methods.
- **Logging:** use the injected logger with optional chaining and structured context,
  e.g. `this.logger?.info(\`[${this.constructor.name}] ...\`, { ... })`, not `console.*`
  on the server.
- **Errors:** never send raw error messages to clients. Throw `ClientError` for
  client-safe 4xx errors and use `sendSafeError` / `toClientResponse`
  (`src/shared/utils/`). Validate route input with `validate()` and cap list sizes
  with `parseLimit` (`src/shared/utils/validation.js`).
- **Tests:** Jest tests go in `tests/unit/{service}/`, Playwright specs in `tests/ui/`.
  Tests that write to disk use `testDataDir()` from `tests/helpers/testData.js`, so
  all test data stays under the git-ignored `.temp/`.
- **Commits:** conventional format scoped by service, e.g. `feat(workflow): ...`,
  `fix(filing): ...`.

## Reporting security issues

See [SECURITY.md](./SECURITY.md). Please don't file security problems as public issues.
