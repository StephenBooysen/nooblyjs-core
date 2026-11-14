/**
 * @fileoverview `nooblyjs add` (feature 09): endpoint, service and provider
 * generators, app.js registration, refusal to overwrite, and the Redis, MongoDB
 * and S3 reachability checks in `doctor`. Temp apps live under .temp/tests/data/.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { testDataDir } = require('../../helpers/testData');
const { main } = require('../../../src/cli');
const { providerChecks, parseMongoUrl } = require('../../../src/cli/doctor');
const { endpointFiles, serviceFiles, registerRoute } = require('../../../src/cli/add');
const { PROVIDER_TEMPLATES, providerFiles } = require('../../../src/cli/providerTemplates');

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

describe('doctor MongoDB and S3 checks (feature 09)', () => {
  const byName = (checks, name) => checks.find((c) => c.name === name);

  it('reads MongoDB hosts without credentials, including replica sets and SRV names', () => {
    expect(parseMongoUrl('mongodb://u:secret@h1:27018,h2/db?replicaSet=rs')).toEqual({
      srv: false, hosts: [{ host: 'h1', port: 27018 }, { host: 'h2', port: 27017 }]
    });
    expect(parseMongoUrl('mongodb+srv://u:secret@cluster.example.net/db')).toEqual({ srv: true, hosts: [{ host: 'cluster.example.net', port: 27017 }] });
    expect(parseMongoUrl('postgres://x')).toBeNull();
  });

  it('probes every MongoDB host, warns when only some answer, and never prints the password', async () => {
    const probe = jest.fn(async (host) => (host === 'h1' ? { ok: true } : { ok: false, detail: 'ECONNREFUSED' }));
    const checks = await providerChecks({ env: { MONGODB_URL: 'mongodb://u:secret@h1:27018,h2/db' }, probe });
    expect(probe).toHaveBeenCalledWith('h1', 27018);
    expect(probe).toHaveBeenCalledWith('h2', 27017);
    expect(byName(checks, 'MongoDB connectivity')).toEqual(expect.objectContaining({ status: 'warn', detail: 'h1:27018 reachable, h2:27017 ECONNREFUSED' }));
    expect(JSON.stringify(checks)).not.toContain('secret');
  });

  it('looks up a mongodb+srv record and fails when no target answers', async () => {
    const resolveSrv = jest.fn(async () => [{ name: 'a.example.net', port: 27017 }]);
    const probe = jest.fn(async () => ({ ok: false, detail: 'timed out' }));
    const checks = await providerChecks({ env: { MONGODB_URL: 'mongodb+srv://cluster.example.net/db' }, probe, resolveSrv });
    expect(resolveSrv).toHaveBeenCalledWith('_mongodb._tcp.cluster.example.net');
    expect(byName(checks, 'MongoDB connectivity').status).toBe('fail');
    const bad = await providerChecks({ env: { MONGODB_URL: 'not mongo' }, probe: jest.fn() });
    expect(byName(bad, 'MongoDB connectivity').status).toBe('fail');
  });

  it('probes S3_ENDPOINT, or the AWS endpoint for the region, and warns without access keys', async () => {
    const probe = jest.fn(async () => ({ ok: true }));
    const minio = await providerChecks({ env: { S3_ENDPOINT: 'http://minio.internal:9000' }, probe });
    expect(probe).toHaveBeenCalledWith('minio.internal', 9000);
    expect(byName(minio, 'S3 credentials').status).toBe('warn');
    const aws = await providerChecks({ env: { S3_BUCKET: 'b', AWS_REGION: 'eu-west-1', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' }, probe });
    expect(probe).toHaveBeenCalledWith('s3.eu-west-1.amazonaws.com', 443);
    expect(byName(aws, 'S3 credentials').status).toBe('ok');
    const unused = await providerChecks({ env: {} });
    expect(byName(unused, 'S3 connectivity').detail).toMatch(/not used/);
  });
});

describe('nooblyjs add provider (feature 09)', () => {
  let dir;
  const run = async (args) => {
    const out = sink();
    const err = sink();
    const code = await main(['add', 'provider', ...args], { stdout: out, stderr: err, cwd: dir });
    return { code, out: out.text(), err: err.text() };
  };

  beforeEach(() => { dir = fs.mkdtempSync(path.join(testDataDir('cli'), 'provider-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('refuses to run outside a nooblyjs-core checkout', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    const res = await run(['caching', 'valkey']);
    expect(res.code).toBe(1);
    expect(res.err).toMatch(/nooblyjs-core checkout/);
  });

  it('rejects a service without a contract suite, and a bad name', async () => {
    expect((await run(['workflow', 'x'])).code).toBe(2);
    expect((await run(['caching', 'Bad_Name'])).code).toBe(2);
  });

  it('writes the provider and its contract runner in a core checkout, prints the case, and refuses to overwrite', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nooblyjs-core' }));
    fs.mkdirSync(path.join(dir, 'src', 'caching'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'caching', 'index.js'), 'module.exports = () => ({});\n');
    fs.mkdirSync(path.join(dir, 'tests', 'contract'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'contract', 'cache.contract.js'), 'module.exports = {};\n');
    const res = await run(['caching', 'valkey']);
    expect(res.code).toBe(0);
    expect(fs.existsSync(path.join(dir, 'src', 'caching', 'providers', 'cachingValkey.js'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tests', 'contract', 'caching.valkey.test.js'))).toBe(true);
    expect(res.out).toContain("case 'valkey':");
    expect(res.out).toContain('cache = new CachingValkey(providerOptions, eventEmitter);');
    expect((await run(['caching', 'valkey'])).code).toBe(1);
  });

  it('generates valid JavaScript for every service, with a stub per contract method', () => {
    for (const service of Object.keys(PROVIDER_TEMPLATES)) {
      const { files, className } = providerFiles({ service, name: 'acme-store' });
      for (const [file, source] of Object.entries(files)) {
        expect(() => new vm.Script(source, { filename: file })).not.toThrow();
      }
      const provider = Object.values(files)[0];
      expect(provider).toContain(`class ${className}`);
      for (const signature of PROVIDER_TEMPLATES[service].methods) {
        expect(provider).toContain(`async ${signature} {`);
      }
      expect(Object.values(files)[1]).toContain('does not create');
    }
  });
});
