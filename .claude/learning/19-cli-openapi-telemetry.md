# 19: CLI, OpenAPI, telemetry and the test kit

**Time:** about 25 minutes · **Example:** [`examples/19-cli-openapi-telemetry.js`](examples/19-cli-openapi-telemetry.js) · **Run:** `node .claude/learning/examples/19-cli-openapi-telemetry.js`

## What you will learn

Use the tools that sit across every service: the OpenAPI document and generated client, the `nooblyjs` command, OpenTelemetry tracing, and the test kit for your own tests.

## Key ideas

- **One OpenAPI document for the whole app.** `GET /services/api/openapi.json` merges the description of every service that is mounted. Each service documents its own routes, and the document is OpenAPI 3.1.
- **Generated clients follow the document.** `nooblyjs openapi --client ts` writes a typed TypeScript client, so your front end calls the API with checked types.
- **The CLI talks to a running app.** It reads `NOOBLYJS_URL` and `NOOBLYJS_API_KEY` (or `NOOBLYJS_TOKEN`), and it does not need the app's code.
- **Telemetry is off by default.** Turn it on in the registry options. Spans and metrics go to a console exporter, an OTLP collector, or memory (for tests).
- **The test kit makes tests short.** `nooblyjs-core/testing` gives you a registry, a test API key, matchers and an event recorder.

## Walk-through

### OpenAPI

```javascript
const openapi = await call('GET', '/services/api/openapi.json');
console.log(openapi.body.openapi);   // 3.1.0
```

Browse the same document at `/services/api/docs`. Each operation lists its parameters, its security requirement and its responses.

### The CLI

```bash
export NOOBLYJS_URL=http://localhost:9000
export NOOBLYJS_API_KEY=your-key

nooblyjs routes                          # every API operation of the running app
nooblyjs openapi --out openapi.json      # save the document
nooblyjs openapi --client ts --out client.ts
nooblyjs doctor                          # check the environment; exits 1 on failure
nooblyjs keys generate --length 48       # print a random API key
```

Scaffolding commands write code into your project:

```bash
nooblyjs create my-app --template api    # a new app
nooblyjs add endpoint GET /reports/:id   # a route, its test and its app.js line
nooblyjs add service billing             # a service class with destroy() and its test
```

`add provider` is for a checkout of NooblyJS Core itself, not for an app that uses it.

### MCP through the CLI

`nooblyjs mcp` is the stdio bridge to the MCP endpoint (tutorial 17).

### Telemetry

```javascript
registry.initialize(app, eventEmitter, {
  telemetry: { enabled: true, exporter: 'console' },   // or 'otlp', or 'memory' for tests
});
console.log(registry.telemetry.status());
```

With telemetry off, `status()` says so. With it on, the async methods of your services are wrapped in spans (`instrumentServices`, on by default; the logging and telemetry services are excluded). The `otlp` exporter sends the spans to a collector; set its endpoint as your collector documents.

### The test kit

```javascript
const { createTestRegistry, installMatchers } = require('nooblyjs-core/testing');

installMatchers();   // adds matchers such as toHaveEmitted to the global expect
const { registry, request, events, cleanup } = await createTestRegistry();
```

`createTestRegistry` returns the registry, the Express app, an event recorder (`events`), a `request` helper that sends the test API key, the temporary directory, the key itself (`apiKey`) and a `cleanup` function. Call `cleanup` in `afterAll`, the same habit as tutorial 01.

## Over REST

| Method | Path | Purpose |
|---|---|---|
| GET | `/services/api/openapi.json` | The OpenAPI 3.1 document |
| GET | `/services/api/openapi.yaml` | The same, as YAML |
| GET | `/services/api/docs` | Browsable documentation |

## Common mistakes

- **Generating a client from an old document.** Regenerate it after you add or change a route, or the types lag behind the API.
- **Putting the API key in a shell history.** Export it from a file or a secret store, not on the command line.
- **Turning on telemetry without a sink.** The `console` exporter prints every span. Use `otlp` or `memory` in production and tests.
- **Using `nooblyjs add` in a project you did not scaffold.** It writes files into your tree. Read the diff before you commit.
- **Expecting the test kit to replace contract tests.** It makes unit tests short; it does not check a provider against the shared contract.

## Try it

1. Generate the TypeScript client and find the function for one route.
2. Run `nooblyjs doctor` and read each line it prints.
3. Turn on telemetry with `memory` and make two calls. Look at what was recorded.
