/**
 * @fileoverview `nooblyjs add` (feature 09): endpoint and service generators,
 * app.js registration, refusal to overwrite, and the Redis reachability checks
 * in `doctor`. Temp apps live under .temp/tests/data/.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { testDataDir } = require('../../helpers/testData');
const { main } = require('../../../src/cli');
const { providerChecks } = require('../../../src/cli/doctor');
const { endpointFiles, serviceFiles, registerRoute } = require('../../../src/cli/add');

function sink() {
  const chunks = [];
  return { write: (c) => { chunks.push(String(c)); return true; }, text: () => chunks.join('') };
}

describe('nooblyjs add (feature 09)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(testDataDir('cli'), 'add-'));
    fs.writeFileSync(path.join(dir, 'app.js'), "'use strict';\nconst port = 9000;\n// nooblyjs:routes\nmodule.exports = {};\n");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes a route and its test, and registers the route before the marker', async () => {
    const out = sink();
    const code = await main(['add', 'endpoint', 'get', '/hello/:name'], { stdout: out, stderr: sink(), cwd: dir });
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(dir, 'routes', 'get-hello-name.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'test', 'get-hello-name.test.js'))).toBe(true);
    const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
    expect(app).toContain("require('./routes/get-hello-name')(app);\n// nooblyjs:routes");
    expect(out.text()).toMatch(/Registered in app\.js/);
  });

  it('prints the line to add when app.js has no marker', async () => {
    fs.writeFileSync(path.join(dir, 'app.js'), 'module.exports = {};\n');
    const out = sink();
    await main(['add', 'endpoint', 'POST', '/items'], { stdout: out, stderr: sink(), cwd: dir });
    expect(out.text()).toMatch(/Add this line to app\.js[\s\S]*require\('\.\/routes\/post-items'\)\(app\);/);
  });

  it('refuses to overwrite an existing route file', async () => {
    fs.mkdirSync(path.join(dir, 'routes'));
    fs.writeFileSync(path.join(dir, 'routes', 'get-hello.js'), 'keep me');
    const err = sink();
    const code = await main(['add', 'endpoint', 'GET', '/hello'], { stdout: sink(), stderr: err, cwd: dir });
    expect(code).toBe(1);
    expect(err.text()).toMatch(/already exists/);
    expect(fs.readFileSync(path.join(dir, 'routes', 'get-hello.js'), 'utf8')).toBe('keep me');
  });

  it('rejects a method it does not know, and a path without a slash', async () => {
    const err = sink();
    expect(await main(['add', 'endpoint', 'TRACE', '/x'], { stdout: sink(), stderr: err, cwd: dir })).toBe(2);
    expect(await main(['add', 'endpoint', 'GET', 'x'], { stdout: sink(), stderr: err, cwd: dir })).toBe(2);
  });

  it('writes a service class with destroy(), and its test runs', async () => {
    const code = await main(['add', 'service', 'audit-trail'], { stdout: sink(), stderr: sink(), cwd: dir });
    expect(code).toBe(0);
    const { EventEmitter } = require('events');
    const Svc = require(path.join(dir, 'services', 'audit-trail.js'));
    const emitter = new EventEmitter();
    const seen = [];
    emitter.on('audit-trail:seen', (p) => seen.push(p));
    const svc = new Svc({}, emitter);
    emitter.emit('audit-trail:input', { n: 1 });
    svc.destroy();
    emitter.emit('audit-trail:input', { n: 2 });
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('rejects a service name that is not kebab case', async () => {
    expect(await main(['add', 'service', 'Bad_Name'], { stdout: sink(), stderr: sink(), cwd: dir })).toBe(2);
  });

  it('generates the same files from the helpers without touching disk', () => {
    expect(Object.keys(endpointFiles({ method: 'delete', routePath: '/a/:id', slug: 'delete-a-id' })).sort())
      .toEqual(['routes/delete-a-id.js', 'test/delete-a-id.test.js']);
    expect(Object.keys(serviceFiles({ name: 'x-y' })).sort()).toEqual(['services/x-y.js', 'test/x-y.test.js']);
    expect(registerRoute(dir, 'nothing-here')).toBe(true);
    expect(registerRoute(dir, 'nothing-here')).toBe(false);
  });
});

describe('doctor provider checks (feature 09)', () => {
  it('reports Redis as not used when no URL is set', async () => {
    const checks = await providerChecks({ env: {} });
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
    expect(checks[0].detail).toMatch(/not set/);
  });

  it('probes the host and port from REDIS_URL and reports the result', async () => {
    const probe = jest.fn(async () => ({ ok: false, detail: 'ECONNREFUSED' }));
    const checks = await providerChecks({ env: { REDIS_URL: 'redis://cache.internal:6380' }, probe });
    expect(probe).toHaveBeenCalledWith('cache.internal', 6380);
    expect(checks[0]).toEqual(expect.objectContaining({ status: 'fail', detail: 'cache.internal:6380 ECONNREFUSED' }));
  });

  it('fails a REDIS_URL that is not a URL, without probing', async () => {
    const probe = jest.fn();
    const checks = await providerChecks({ env: { REDIS_URL: 'not a url' }, probe });
    expect(probe).not.toHaveBeenCalled();
    expect(checks[0].status).toBe('fail');
  });
});
