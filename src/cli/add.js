/**
 * @fileoverview `nooblyjs add endpoint|service` (feature 09). Writes a route or a
 * service class, plus a test, into an app created with `nooblyjs create`, and
 * adds the registration line to app.js when the marker `// nooblyjs:routes` is
 * there. Refuses to overwrite a file that already exists.
 *
 * `add provider` is not here yet: a provider needs the core repository's contract
 * suite, so it belongs in a core checkout.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('./index');

const MARKER = '// nooblyjs:routes';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;

/**
 * Builds the route module and its test for one endpoint.
 * @param {{method: string, routePath: string, slug: string}} input
 * @return {Object<string, string>} Relative path to contents
 */
function endpointFiles({ method, routePath, slug }) {
  const m = method.toLowerCase();
  const label = `${method.toUpperCase()} ${routePath}`;
  return {
    [`routes/${slug}.js`]: `'use strict';

const { validate } = require('nooblyjs-core/src/shared/utils/validation.js');
const { sendSafeError } = require('nooblyjs-core/src/shared/utils/safeError.js');

/**
 * ${label}. Describe the input with validate(), then replace the body with your logic.
 * @param {import('express').Application} app
 */
module.exports = function register(app) {
  app.${m}('${routePath}', validate({}), (req, res) => {
    try {
      res.status(200).json({ success: true, data: { route: '${label}' } });
    } catch (err) {
      sendSafeError(res, err, { status: 500 });
    }
  });
};
`,
    [`test/${slug}.test.js`]: `'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('../app');

test('${label} answers', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(\`http://127.0.0.1:\${port}${routePath.replace(/:([A-Za-z]+)/g, '1')}\`, { method: '${method.toUpperCase()}' });
    assert.strictEqual(res.status, 200);
  } finally {
    server.close();
  }
});
`
  };
}

/**
 * Builds a service class with a destroy() hook and its test.
 * @param {{name: string}} input
 * @return {Object<string, string>} Relative path to contents
 */
function serviceFiles({ name }) {
  const cls = name.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  return {
    [`services/${name}.js`]: `'use strict';

/**
 * ${cls}: a service that emits events on the shared emitter. Call destroy()
 * when the app shuts down, so its listeners are released.
 */
class ${cls} {
  /**
   * @param {Object} [options]
   * @param {import('events').EventEmitter} eventEmitter Shared emitter
   */
  constructor(options = {}, eventEmitter) {
    this.options = options;
    this.eventEmitter = eventEmitter;
    this.onEvent = (payload) => this.eventEmitter?.emit?.('${name}:seen', payload);
    this.eventEmitter?.on?.('${name}:input', this.onEvent);
  }

  /** Removes listeners. Safe to call twice. */
  destroy() {
    this.eventEmitter?.off?.('${name}:input', this.onEvent);
  }
}

module.exports = ${cls};
`,
    [`test/${name}.test.js`]: `'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const ${cls} = require('../services/${name}');

test('${cls} re-emits input and stops after destroy()', () => {
  const emitter = new EventEmitter();
  const seen = [];
  emitter.on('${name}:seen', (p) => seen.push(p));
  const service = new ${cls}({}, emitter);
  emitter.emit('${name}:input', { n: 1 });
  service.destroy();
  emitter.emit('${name}:input', { n: 2 });
  assert.deepStrictEqual(seen, [{ n: 1 }]);
});
`
  };
}

/**
 * Writes files without overwriting anything.
 * @param {string} root App root
 * @param {Object<string, string>} files Relative path to contents
 * @return {string[]} Relative paths written
 * @throws {Error} When a file already exists
 */
function writeNew(root, files) {
  const clashes = Object.keys(files).filter((rel) => fs.existsSync(path.join(root, rel)));
  if (clashes.length) throw Object.assign(new Error(`already exists: ${clashes.join(', ')}`), { usage: false });
  for (const [rel, contents] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return Object.keys(files);
}

/**
 * Adds a require line for a route module to app.js, before the marker.
 * @param {string} root App root
 * @param {string} slug Route module name
 * @return {boolean} True when app.js was changed
 */
function registerRoute(root, slug) {
  const appFile = path.join(root, 'app.js');
  if (!fs.existsSync(appFile)) return false;
  const text = fs.readFileSync(appFile, 'utf8');
  if (!text.includes(MARKER) || text.includes(`./routes/${slug}`)) return false;
  const line = `require('./routes/${slug}')(app);\n`;
  fs.writeFileSync(appFile, text.replace(MARKER, `${line}${MARKER}`));
  return true;
}

/**
 * Runs `nooblyjs add endpoint <METHOD> <path>` or `nooblyjs add service <name>`.
 *
 * @param {string[]} args Arguments after `add`
 * @param {Object} io Streams and working directory
 * @return {Promise<number>} Exit code
 */
async function run(args, io) {
  const { positionals } = parse(args, {});
  const [kind, ...rest] = positionals;
  const root = io.cwd || process.cwd();
  const usage = 'Usage:\n  nooblyjs add endpoint <METHOD> <path>   e.g. nooblyjs add endpoint GET /hello\n  nooblyjs add service <name>             e.g. nooblyjs add service audit-trail\n';

  try {
    if (kind === 'endpoint') {
      const [method, routePath] = rest;
      if (!METHODS.includes(String(method || '').toLowerCase()) || !String(routePath || '').startsWith('/')) {
        io.stderr.write(usage);
        return 2;
      }
      const slug = routePath.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'root';
      const name = `${method.toLowerCase()}-${slug}`;
      if (!SLUG.test(name)) {
        io.stderr.write(`Cannot make a file name from "${method} ${routePath}".\n`);
        return 2;
      }
      const written = writeNew(root, endpointFiles({ method, routePath, slug: name }));
      const wired = registerRoute(root, name);
      io.stdout.write(`Added ${method.toUpperCase()} ${routePath}\n  ${written.join('\n  ')}\n`);
      io.stdout.write(wired ? 'Registered in app.js.\n' : `Add this line to app.js before "${MARKER}":\n  require('./routes/${name}')(app);\n`);
      return 0;
    }
    if (kind === 'service') {
      const [name] = rest;
      if (!SLUG.test(String(name || ''))) {
        io.stderr.write(usage);
        return 2;
      }
      const written = writeNew(root, serviceFiles({ name }));
      io.stdout.write(`Added service ${name}\n  ${written.join('\n  ')}\n`);
      io.stdout.write(`Create it where your app starts:\n  const ${name.replace(/-(\w)/g, (_, c) => c.toUpperCase())} = require('./services/${name}');\n`);
      return 0;
    }
    io.stderr.write(usage);
    return 2;
  } catch (error) {
    io.stderr.write(`nooblyjs add: ${error.message}\n`);
    return 1;
  }
}

module.exports = { run, endpointFiles, serviceFiles, registerRoute };
