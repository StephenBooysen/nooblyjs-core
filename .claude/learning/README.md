---
type: Learning Guide
title: 'NooblyJS Core: learning tutorials'
description: These tutorials teach each NooblyJS Core service by doing.
---

# NooblyJS Core: learning tutorials

These tutorials teach each NooblyJS Core service by doing. Each one has a runnable example in [`examples/`](examples/) and a written walk-through of that example. The examples are tested: every one runs from the repository root and prints what the tutorial describes.

## Before you start

You need Node.js 22 or later and a checkout of this repository.

```bash
npm install
node .claude/learning/examples/01-logging.js
```

If that prints a few lines and exits with code 0, you are set up.

Every example starts with [`examples/setup.js`](examples/setup.js). It creates one Express app, initializes the service registry, and turns on the MCP endpoint. It also requires the API key `learning-key` on every `/services/*/api` call, the way production does. The example then calls the REST routes with that key. The setup is for learning on your own machine: production settings are in the main [README](../../README.md#security).

The examples write their files and logs under `.temp/learning/`, which is git-ignored.

## How each tutorial is laid out

1. **What you will learn**: the goal in one sentence.
2. **Key ideas**: the concepts you need before the code.
3. **Walk-through**: the example, section by section.
4. **Over REST**: the routes for the same service, with the curl call.
5. **Providers**: what the `type` argument can be and when to use each.
6. **Common mistakes**: what goes wrong and why.
7. **Try it**: exercises that change the example.

## Learning path

Start at the top. Each tutorial assumes the ones before it, though the middle of the list can be read in any order.

| # | Tutorial | Example | What it teaches |
|---|---|---|---|
| 01 | [Logging](01-logging.md) | `01-logging.js` | Structured logs, reading them back |
| 02 | [Caching](02-caching.md) | `02-caching.js` | Keys and values, named instances |
| 03 | [Queueing](03-queueing.md) | `03-queueing.js` | FIFO queues, reliable jobs |
| 04 | [Fetching](04-fetching.md) | `04-fetching.js` | HTTP with the SSRF guard and a response cache |
| 05 | [Notifying and webhooks](05-notifying.md) | `05-notifying.js` | Topics, signed outbound webhooks |
| 06 | [Settings and feature flags](06-settings-and-flags.md) | `06-settings-and-flags.js` | Encrypted settings, flags with rollouts |
| 07 | [Data service](07-dataservice.md) | `07-dataservice.js` | Records in containers, uuids |
| 08 | [Filing](08-filing.md) | `08-filing.js` | Files in a storage root, path safety, uploads |
| 09 | [Measuring](09-measuring.md) | `09-measuring.js` | Totals and averages over time |
| 10 | [Working](10-working.md) | `10-working.js` | Running activities in worker threads |
| 11 | [Scheduling](11-scheduling.md) | `11-scheduling.js` | Intervals, cron, pause and history |
| 12 | [Workflow](12-workflow.md) | `12-workflow.js` | Named sequences of activities, state |
| 13 | [Searching](13-searching.md) | `13-searching.js` | Indexing, ranking, suggestions |
| 14 | [Auth service](14-authservice.md) | `14-authservice.js` | Users, sessions, tokens, password policy |
| 15 | [AI service](15-aiservice.md) | `15-aiservice.js` | One API for models, budgets, embeddings |
| 16 | [Knowledge](16-knowledge.md) | `16-knowledge.js` | Cited answers over your documents |
| 17 | [MCP endpoint](17-mcp.md) | `17-mcp.js` | Letting a coding agent use a running app |
| 18 | [App service](18-appservice.md) | `18-appservice.js` | Base classes for your own routes and services |
| 19 | [CLI, OpenAPI and telemetry](19-cli-openapi-telemetry.md) | `19-cli-openapi-telemetry.js` | The developer tools that cover every service |

## Running the examples together

Each example is independent and exits when it finishes. Run them all with:

```bash
for f in .claude/learning/examples/[0-9]*.js; do node "$f" || echo "FAILED: $f"; done
```

Some examples need internet access (fetching, and the public webhook test in 05). They report the outcome either way.

## Concepts that apply to every service

- **Factories.** Every service is created through the registry: `registry.cache('memory')`, `registry.queue('redis')`. The first argument is the provider, the second is options.
- **Providers.** One service, several backends. The methods are the same for each provider, so code written against `memory` works against `redis` once you change the provider name. Your code should use the names listed in each tutorial, because most factories fall back silently to the memory provider when they do not recognise a name.
- **Named instances.** `{ instanceName: 'sessions' }` gives a second, separate instance of the same service.
- **Dependencies.** Some services need others: notifying needs queueing and settings, scheduling needs working. The registry creates them for you, or reuses the ones you created first.
- **REST routes.** A service's routes exist once the service is created through the registry. They are under `/services/<service>/api`, and every declared route needs a permission. The examples use the API key; production uses scoped keys or personal access tokens.
- **Events.** Each service emits events on a shared emitter, for example `measuring:add` or `workflow:state:changed`. Listen to them with `eventEmitter.on(...)` to react to changes.
- **Dashboards.** Each service has a page under `/services/<service>/` for people to look at its state.

## Where to go next

- The [usage guide](../steering/Usage%20Guide.md) has longer examples and patterns.
- The [architecture document](../steering/Application%20Architecture.md) explains how the registry, providers and routes fit together.
- The [product requirements](../steering/Product%20Requirements.md) describe each service's full scope.
