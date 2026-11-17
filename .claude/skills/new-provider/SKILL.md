---
type: Skill
name: new-provider
description: Add a new backend provider (e.g. Redis, a cloud SDK) to an existing nooblyjs-core service, with parity to the default provider, factory registration, optional-dependency handling and tests. Use when the user asks to support a new backend for caching, queueing, dataservice, filing, etc.
argument-hint: "<service> <providerType>"
---

# Add a provider

Target: $ARGUMENTS

## Before writing

- Read the service's default provider (`src/{service}/providers/{service}.js`, or `provider/` for aiservice/measuring) and one existing external provider. The new provider must expose the same public methods with the same signatures and return shapes — callers and routes rely on them.
- If there's a base class (e.g. `authBase.js`, `aibase.js`, `MongoBaseProvider.js`), extend it.
- Check the factory's `switch` in `src/{service}/index.js` for the naming style of existing cases (`redis`, `aws`, `azure`, `gcp`, `api`, …).

## Implement

- File: `src/{service}/providers/{service}{Provider}.js` (match existing casing, e.g. `cachingRedis.js`, `queueingAWS.js`).
- Constructor `(options = {}, eventEmitter)`: logger from `options.dependencies?.logging`, `instanceName_`, and `this.settings` with a `list` describing any connection options that should appear in the dashboard.
- Connection details come from `options` first, then environment variables; never hard-code credentials.
- **Optional SDKs:** heavy or cloud SDKs must not break installs that don't use them. `require` them lazily inside the constructor or connect method, and throw a clear error naming the package to install if missing. Don't add them to `dependencies` in `package.json` unless the user agrees (prefer `optionalDependencies`).
- Emit the same events as the default provider so analytics keeps working.
- Log connection lifecycle and failures via `this.logger?.` with structured context (host, region, operation — never secrets).
- Provide cleanup (`close()` / `disconnect()`) if it opens connections, so `ServiceRegistry.shutdown()` and tests don't leave open handles.

## Register

- Add a `case '{providerType}':` in the service factory.
- Update the provider list for the service in `CLAUDE.md`.
- If apps should be able to inject it as a dependency, note that callers use `serviceRegistry.setDefaultProvider('{service}', '{providerType}', options)` before creating dependents.

## Test

- Unit tests in `tests/unit/{service}/` that mock the SDK/client (`jest.mock('package')`) so the suite runs without the external system.
- If a real-backend test is valuable, gate it behind an env var (like `RUN_MONGODB_TESTS=1`) and skip otherwise — don't commit tests that fail without infrastructure.
- Optional demo app: `tests/app/{service}/app-{service}-{providerType}.js`.
- Run `npm test`. Ad-hoc checks against a real backend go in `.temp/tests/`; a summary of the provider and its options goes in `.temp/updates/`.
