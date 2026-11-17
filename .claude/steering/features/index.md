# Documents

* [Roadmap: Engineering Acceleration](00.%20Roadmap%20-%20Engineering%20Acceleration.md) - NooblyJS Core already gives a team a lot that usually takes weeks to assemble: 16 services behind one registry, pluggable providers (memory to Redis to AWS/Azure/GCP), a REST API and dashboard per...
* [Feature: Searching Service Semantic Search (phases 2–4)](01.%20Feature%20Searching%20Service%20Semantic%20Search.md) - This file was missing from the repo; the roadmap linked to it.
* [Feature: AI Service v2 on nooblyjs-ai-common](02.%20Feature%20AI%20Service%20v2%20on%20AI%20Common.md) - The repo has two AI layers that don't meet:
* [Feature: MCP Server for the Service Registry](03.%20Feature%20MCP%20Server.md) - Engineers now debug and build with coding agents (Claude Code, Cursor, Copilot).
* [Feature: Agentic Workflows](04.%20Feature%20Agentic%20Workflows.md) - The workflow service runs a named list of step scripts in worker threads, with schedules, history, cancel and state export.
* [Feature: Knowledge Service (Retrieval-Augmented Generation)](05.%20Feature%20Knowledge%20Service%20RAG.md) - "Chat with our docs / tickets / wiki" is the most requested AI feature in internal tools.
* [Feature: Reliable Jobs](06.%20Feature%20Reliable%20Jobs.md) - The queue interface is enqueue, dequeue, size, listQueues, purge.
* [Feature: OpenTelemetry Observability](07.%20Feature%20OpenTelemetry%20Observability.md) - NooblyJS has per-service analytics, a monitoring snapshot (/services/api/monitoring/{metrics,snapshot}), health probes and a structured logger.
* [Feature: TypeScript Types and Validated Config](08.%20Feature%20TypeScript%20Types%20and%20Validated%20Config.md) - First-class types for the registry and every service, and fail-fast validation of options at startup, with no runtime cost for JavaScript users.
* [Feature: Developer CLI (npx nooblyjs)](09.%20Feature%20Developer%20CLI.md) - Starting a NooblyJS app means copying app.js (about 200 lines that wire every service) and trimming it.
* [Feature: Unified OpenAPI and Generated Clients](10.%20Feature%20Unified%20OpenAPI%20and%20Generated%20Clients.md) - Each service ships its own Swagger document (routes/swagger/docs.json) and the service template renders it.
* [Feature: Test Kit and Provider Contract Tests](11.%20Feature%20Test%20Kit%20and%20Provider%20Contract%20Tests.md) - A test kit that makes app tests a few lines, and one contract suite per service that every provider must pass, runnable against real backends in containers.
* [Feature: Webhooks and Transactional Outbox](12.%20Feature%20Webhooks%20and%20Outbox.md) - Integration with other systems is most of a backend engineer's work.
* [Feature: Feature Flags](13.%20Feature%20Feature%20Flags.md) - Trunk-based development and safe rollouts depend on feature flags.
* [Feature: Express 5, ESM and a Node 22 Baseline](14.%20Feature%20Express%205%20ESM%20and%20Node%2022.md) - The registry mounts on Express 4 and 5, the package works natively from ESM and CommonJS, and the supported Node versions match what CI tests.
* [Feature: Filing Authorization and Locked Settings](15.%20Feature%20Filing%20Authorization%20and%20Locked%20Settings.md) - The filing API is exempt from the admin guard so that wiki, Teams and browser-extension users can read documents.
* [Feature: Invitation and Onboarding Hardening](16.%20Feature%20Invitation%20and%20Onboarding%20Hardening.md) - Direct registration is disabled (/api/register returns 403), but the invitation flow re-opens it:
* [Feature: Safe Content Serving and a Strict CSP](17.%20Feature%20Safe%20Content%20Serving%20and%20Strict%20CSP.md) - A plain user can therefore upload an HTML or SVG file whose script runs with an admin's session when the admin opens it.
* [Feature: Code Execution Boundary for Working, Scheduling and Workflow](18.%20Feature%20Code%20Execution%20Boundary.md) - Three services run JavaScript files in worker_threads, and all three let the caller choose the file:
* [Feature: Route-Level RBAC and Scoped API Keys](19.%20Feature%20Route-Level%20RBAC%20and%20Scoped%20API%20Keys.md) - Authorization today has two layers that don't line up:
* [Feature: Dependency and Supply-Chain Hygiene](20.%20Feature%20Dependency%20and%20Supply-Chain%20Hygiene.md) - On 2026-09-29, npm audit --omit=dev reported zero advisories.
* [Feature: Horizontal Scaling Readiness](21.%20Feature%20Horizontal%20Scaling%20Readiness.md) - Sessions can already live in Redis (SESSION_REDIS_URL), but other state that must be shared across replicas still lives in one process:
* [Feature: Security Regression Suite and Continuous Verification](22.%20Feature%20Security%20Regression%20Suite%20and%20Continuous%20Verification.md) - The suite is strong on unit behaviour (2,228 passing tests, plus dedicated SSRF, traversal, brute-force and listener-leak tests), and the September live probe passed 70/70 checks.
* [Feature: Session and Token Hygiene](23.%20Feature%20Session%20and%20Token%20Hygiene.md) - Session credentials never appear in URLs or script-readable storage, and sessions follow current OWASP guidance.
