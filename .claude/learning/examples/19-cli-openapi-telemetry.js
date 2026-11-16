'use strict';
// Example 19: the developer tools that sit across all services: OpenAPI, the
// nooblyjs CLI, and OpenTelemetry tracing.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const { registry, serve, call, root, API_KEY, done } = require('./setup');

(async () => {
  // Create a few services so their routes are in the document.
  registry.cache('memory');
  registry.queue('memory');
  registry.logger('memory');

  // 1. OpenAPI: one document for every mounted service, with a 3.1 schema.
  const openapi = await call('GET', '/services/api/openapi.json');
  const operations = Object.values(openapi.body.paths).reduce(
    (count, item) => count + Object.keys(item).filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m)).length,
    0
  );
  console.log('openapi', openapi.body.openapi, 'operations', operations);

  // 2. The CLI talks to a running app. It reads the URL and key from the
  //    environment; here it is pointed at this example server.
  const base = await serve();
  const cli = path.join(root, 'bin', 'nooblyjs.js');
  // Async: the server in this process must keep answering while the CLI runs.
  const { stdout: routes } = await execFileAsync(process.execPath, [cli, 'routes', '--url', base], {
    env: { ...process.env, NOOBLYJS_API_KEY: API_KEY },
  });
  console.log('cli routes (first lines):');
  console.log(routes.split('\n').slice(0, 4).join('\n'));

  // 3. Telemetry is off unless the registry is started with
  //    telemetry: { enabled: true }. This example's registry does not turn it
  //    on, so the status says why.
  const status = registry.telemetry.status();
  console.log('telemetry', status);

  done();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
