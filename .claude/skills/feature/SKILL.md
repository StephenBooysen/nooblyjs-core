---
type: Skill
name: feature
description: End-to-end workflow for building a feature in nooblyjs-core — scope it, implement it following the service conventions, test it, write the feature notes to .temp/updates, and run the full suite. Use when the user asks to add or change behaviour in a service.
argument-hint: "<feature description>"
---

# Build a feature

Feature request: $ARGUMENTS

## 1. Scope

- Identify the service(s) touched under `src/{service}/`. Read the factory (`index.js`), the provider(s) in `providers/`, and `routes/index.js` before changing anything.
- Check the dependency graph in `index.js` → `initializeServiceDependencies()`. A feature must not make a service depend on one at the same or a higher level; if it needs to, say so and propose an alternative (event, option, or moving logic up a level).
- If the request is ambiguous in a way that changes the API shape, ask before building.

## 2. Implement

Follow the repo conventions (see `CLAUDE.md` and `.claude/rules/`):
- Put behaviour in the provider; keep providers of the same service at parity where it makes sense (memory/default first, then others). The `*Api.js` provider proxies to a remote instance — add the matching method there when the feature is part of the public service API.
- Emit events on the injected `eventEmitter` for significant operations, namespaced like `service:action:${instanceName}` where the service already does so.
- Logging: `this.logger?.info(\`[${this.constructor.name}] ...\`, { ...context })` — never `console.*` in server code.
- JSDoc every public method (`@param`, `@return`, `@throws`, `@example`).
- New configuration goes into the provider's `this.settings.list` (`{ setting, type, values }`) with a default from `options`, so it shows up in the dashboard Settings tab.
- New REST endpoints: use the `add-endpoint` skill. New providers: `new-provider`. New services: `new-service`.

## 3. Test

- Add or extend Jest tests under `tests/unit/{service}/` (use the `write-tests` skill). Cover the happy path, validation errors, and emitted events.
- If the feature changes a dashboard or client UI (`views/`, `scripts/`), add or extend a Playwright spec in `tests/ui/` and run `npm run test:ui` — check it at both desktop and mobile widths (both projects run by default).
- Any ad-hoc verification (scripts, curl runs, captured output) goes in `.temp/tests/` — not in `tests/`.
- Run the service's tests, then the whole suite: `npm test`. Report failures with output; don't claim success on a partial run.

## 4. Document

- Write a short feature note to `.temp/updates/<YYYY-MM-DD>-<feature-slug>.md`: what changed, new/changed API (endpoints, methods, options, events, settings), migration or breaking-change notes, and how it was tested.
- Update the service's Swagger doc (`routes/swagger/docs.json`) and `tests/api/{service}/*.http` examples if endpoints changed.
- Update `CLAUDE.md` only if the change affects architecture or conventions future sessions need to know.

## 5. Finish

Summarise what changed and the test result. Don't commit unless asked; when asked, use a conventional message scoped by service, e.g. `feat(notifying): add topic TTL`.
