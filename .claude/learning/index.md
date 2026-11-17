# Documents

* [01: Logging](01-logging.md) - Write structured log entries from your code, read them back over REST, and choose a logging backend.
* [02: Caching](02-caching.md) - Store values by key, read them back, delete them, and keep separate caches for different purposes with named instances.
* [03: Queueing](03-queueing.md) - Put work on a named queue, take it off in order, and use reliable jobs with retries, a dead-letter queue and idempotency keys.
* [04: Fetching](04-fetching.md) - Make outbound HTTP requests through the fetching service, why it refuses some addresses, and how responses are cached.
* [05: Notifying and webhooks](05-notifying.md) - Send messages to topics inside your app, and send signed webhooks to other systems, and verify those signatures on the receiving side.
* [06: Settings and feature flags](06-settings-and-flags.md) - Store grouped configuration values, keep secrets encrypted, and switch features on for some callers with feature flags.
* [07: Data service](07-dataservice.md) - Store JSON records in named containers, find and change them by uuid, search by text, and choose a database for production.
* [08: Filing](08-filing.md) - Create, read, update, list and delete files in a storage root, see how paths are kept inside it, and accept uploads safely over REST.
* [09: Measuring](09-measuring.md) - Record numbers as they happen, then ask for totals and averages across all time or across a period.
* [10: Working](10-working.md) - Write an activity, run it in a worker thread, read its result, and understand the limits that keep activities safe.
* [11: Scheduling](11-scheduling.md) - Run an activity every few seconds, or on a cron schedule, pause and resume it, and read its run history.
* [12: Workflow](12-workflow.md) - Define a named sequence of activities, run it with input, read its history, and keep its state across restarts.
* [13: Searching](13-searching.md) - Index documents, search them with ranked results, get suggestions as someone types, and remove documents from the index.
* [14: Auth service](14-authservice.md) - Create users with a password policy, sign them in, check and end sessions, issue personal access tokens with narrower scopes, and understand how the auth service controls access to the dashboard...
* [15: AI service](15-aiservice.md) - Call a model through one API whatever the provider, read the reply and its usage, ask for structured output, create embeddings, and keep spending under control with budgets.
* [16: Knowledge](16-knowledge.md) - Answer questions from your own documents, with numbered citations that point at the source, and give the service feedback so it can be checked.
* [17: MCP endpoint](17-mcp.md) - Let a coding agent (such as Claude Code) read and use a running NooblyJS app through the Model Context Protocol, with the same permissions as the REST API.
* [18: AppService](18-appservice.md) - Build your own application on top of NooblyJS: routes, services, data access and background work, using the base classes the appservice service provides and the services you have already learned.
* [19: CLI, OpenAPI, telemetry and the test kit](19-cli-openapi-telemetry.md) - Use the tools that sit across every service: the OpenAPI document and generated client, the nooblyjs command, OpenTelemetry tracing, and the test kit for your own tests.
* [NooblyJS Core: learning tutorials](README.md) - These tutorials teach each NooblyJS Core service by doing.
