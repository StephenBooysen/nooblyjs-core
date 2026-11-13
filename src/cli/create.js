/**
 * @fileoverview `nooblyjs create <dir>`: writes a minimal, working API app (feature
 * 09). The app wires the registry the way app.js does: API keys from the
 * environment, file-backed auth and settings, in-memory services, and a `/health`
 * route. Only the `api` template exists so far; the dashboard and AI templates
 * are not written yet.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./index');

const CORE_VERSION = require('../../package.json').version;

/**
 * Returns the files of the api template.
 * @param {string} name App name, used in package.json
 * @return {Object<string, string>} Relative path to contents
 */
function apiTemplate(name) {
  const pkg = {
    name,
    version: '0.1.0',
    private: true,
    main: 'app.js',
    scripts: {
      start: 'node app.js',
      dev: 'node --watch app.js',
      test: 'node --test test/'
    },
    engines: { node: '>=22' },
    dependencies: {
      express: '^4.21.2',
      'nooblyjs-core': `^${CORE_VERSION}`
    }
  };
  return {
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    'app.js': `'use strict';

// A NooblyJS API app. Wires the registry the way the core app.js does.
const path = require('node:path');
const { EventEmitter } = require('node:events');
const express = require('express');
const registry = require('nooblyjs-core');

const isProduction = process.env.NODE_ENV === 'production';
const apiKeys = (process.env.API_KEYS || process.env.NOOBLYJS_API_KEYS || '')
  .split(',').map((k) => k.trim()).filter(Boolean);
if (apiKeys.length === 0 && isProduction) {
  console.error('Set API_KEYS (comma-separated) before starting in production.');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const eventEmitter = new EventEmitter();
registry.initialize(app, eventEmitter, {
  logDir: path.join(__dirname, '.application', 'logs'),
  dataDir: path.join(__dirname, '.application', 'data'),
  apiKeys,
  requireApiKey: apiKeys.length > 0,
  excludePaths: ['/health', '/services/*/status']
});

registry.logger('memory');
registry.cache('memory');
registry.queue('memory');
registry.dataService('memory');

const port = Number(process.env.PORT) || 9000;
if (require.main === module) {
  app.listen(port, () => console.log(\`listening on http://localhost:\${port}\`));
}

module.exports = { app, registry };
`,
    '.env.example': `# Copy to .env and fill in. Never commit real keys.
PORT=9000
API_KEYS=change-me-to-a-long-random-value
SESSION_SECRET=change-me-to-at-least-32-random-characters
`,
    '.gitignore': 'node_modules/\n.application/\n.env\n',
    'test/app.test.js': `'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('../app');

test('health answers ok', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(\`http://127.0.0.1:\${port}/health\`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { status: 'ok' });
  } finally {
    server.close();
  }
});
`,
    'README.md': `# ${name}

A NooblyJS API app.

\`\`\`bash
npm install
cp .env.example .env
npm start        # http://localhost:9000
npm test
\`\`\`

Browse the services at /services once you have an API key (x-api-key header).
`
  };
}

/**
 * Runs `nooblyjs create <dir> [--yes] [--template api]`.
 *
 * @param {string[]} args Arguments after `create`
 * @param {Object} io Streams and working directory
 * @return {Promise<number>} Exit code
 */
async function run(args, io) {
  const { values, positionals } = parse(args, {
    yes: { type: 'boolean', default: false },
    template: { type: 'string', default: 'api' }
  });
  if (positionals.length !== 1) {
    io.stderr.write('Usage: nooblyjs create <dir> [--yes] [--template api]\n');
    return 2;
  }
  if (values.template !== 'api') {
    io.stderr.write(`Template "${values.template}" is not available yet. Only "api" exists.\n`);
    return 2;
  }
  const dir = path.resolve(io.cwd || process.cwd(), positionals[0]);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0 && !values.yes) {
    io.stderr.write(`${dir} is not empty. Pass --yes to write into it anyway.\n`);
    return 1;
  }
  const files = apiTemplate(path.basename(dir));
  for (const [rel, contents] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  io.stdout.write(`Created ${dir}\nNext: cd ${positionals[0]} && npm install && npm test && npm start\n`);
  return 0;
}

module.exports = { run, apiTemplate };
