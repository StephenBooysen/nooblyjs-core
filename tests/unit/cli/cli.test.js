/**
 * @fileoverview The `nooblyjs` command-line tool (feature 09): help and errors,
 * keys, doctor checks, routes, the MCP stdio bridge, the create template, and an
 * integration test that generates the TypeScript client, compiles it with
 * `tsc --strict` and calls a running app with it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { Readable, Writable } = require('stream');
const express = require('express');
const { EventEmitter } = require('events');
const { main } = require('../../../src/cli');
const { checkEnvironment } = require('../../../src/cli/doctor');
const { generateTypeScriptClient } = require('../../../src/cli/tsClient');
const { apiTemplate } = require('../../../src/cli/create');
const { testDataDir } = require('../../helpers/testData');

/** Collects output written to a fake stream. */
function sink() {
  let text = '';
  const stream = new Writable({ write(chunk, _enc, cb) { text += chunk.toString(); cb(); } });
  return { stream, text: () => text };
}

/** Runs the CLI with captured streams. */
async function cli(argv, extra = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { stdout: stdout.stream, stderr: stderr.stream, env: {}, cwd: testDataDir('cli'), ...extra });
  return { code, out: stdout.text(), err: stderr.text() };
}

describe('nooblyjs CLI (feature 09)', () => {
  describe('dispatch', () => {
    it('prints help and exits 0', async () => {
      const r = await cli(['help']);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/nooblyjs create/);
      expect(r.out).toMatch(/NOOBLYJS_TOKEN/);
    });

    it('refuses an unknown command with exit 2', async () => {
      const r = await cli(['frobnicate']);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/Unknown command/);
    });

    it('reports an unknown flag as a usage error', async () => {
      const r = await cli(['keys', 'generate', '--nope']);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/Unknown option/);
    });
  });

  describe('keys generate', () => {
    it('prints a random key of the requested length, different each time', async () => {
      const a = await cli(['keys', 'generate', '--length', '40']);
      const b = await cli(['keys', 'generate', '--length', '40']);
      expect(a.out.trim()).toMatch(/^[0-9a-f]{40}$/);
      expect(a.out).not.toBe(b.out);
    });

    it('refuses a length outside 16 to 256', async () => {
      const r = await cli(['keys', 'generate', '--length', '4']);
      expect(r.code).toBe(2);
    });
  });

  describe('doctor checks', () => {
    const base = { dir: testDataDir('cli-doctor'), nodeVersion: 'v24.1.0', audit: null };
    const statusOf = (checks, name) => checks.find((c) => c.name === name).status;

    it('fails the production secrets and keys when they are missing', () => {
      const checks = checkEnvironment({ ...base, env: { NODE_ENV: 'production' }, production: true });
      expect(statusOf(checks, 'SESSION_SECRET')).toBe('fail');
      expect(statusOf(checks, 'API keys')).toBe('fail');
      expect(statusOf(checks, 'TRUST_PROXY')).toBe('warn');
    });

    it('only warns for the same settings in development', () => {
      const checks = checkEnvironment({ ...base, env: {}, production: false });
      expect(checks.some((c) => c.status === 'fail' && c.name !== 'CSP mode')).toBe(false);
      expect(statusOf(checks, 'SESSION_SECRET')).toBe('warn');
    });

    it('passes a complete production environment', () => {
      const env = {
        NODE_ENV: 'production',
        SESSION_SECRET: 'x'.repeat(40),
        API_KEYS: 'k1',
        SETTINGS_SECRET: 'y'.repeat(40),
        TRUST_PROXY: '1',
        CSP_MODE: 'enforce'
      };
      const checks = checkEnvironment({ ...base, env, production: true, audit: () => ({ ok: true, detail: 'clean' }) });
      expect(checks.filter((c) => c.status === 'fail')).toEqual([]);
    });

    it('fails on an invalid CSP mode and on a failed audit', () => {
      const checks = checkEnvironment({
        ...base,
        env: { CSP_MODE: 'loose' },
        production: false,
        audit: () => ({ ok: false, detail: '3 high advisories' })
      });
      expect(statusOf(checks, 'CSP mode')).toBe('fail');
      expect(statusOf(checks, 'npm audit (production, high)')).toBe('fail');
    });

    it('returns exit 1 from the command when a check fails, 0 when none do', async () => {
      const dir = testDataDir('cli-doctor-run');
      const bad = await cli(['doctor', '--skip-audit', '--dir', dir], { env: { CSP_MODE: 'loose' } });
      expect(bad.code).toBe(1);
      const good = await cli(['doctor', '--skip-audit', '--dir', dir], { env: { SESSION_SECRET: 'x'.repeat(40), API_KEYS: 'k' } });
      expect(good.code).toBe(0);
      expect(good.out).toMatch(/\[warn\] npm audit \(production, high\)/);
    });
  });

  describe('routes and openapi against a fake app', () => {
    const doc = {
      openapi: '3.1.0',
      paths: {
        '/services/caching/api/get/{key}': { get: { tags: ['Caching'], summary: 'Get', security: [{ ApiKeyAuth: [] }] } },
        '/services/api/status': { get: { tags: ['App'], security: [] } }
      }
    };
    const fetchFake = jest.fn(async (url, init) => ({
      ok: true,
      status: 200,
      json: async () => doc,
      text: async () => JSON.stringify(doc),
      _init: init
    }));

    it('lists operations with their auth from the running app, sending the API key', async () => {
      fetchFake.mockClear();
      const r = await cli(['routes', '--url', 'http://app.test'], { fetch: fetchFake, env: { NOOBLYJS_API_KEY: 'secret-key' } });
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/GET\s+\/services\/caching\/api\/get\/\{key\}/);
      expect(r.out).toMatch(/ApiKeyAuth/);
      expect(r.out).toMatch(/none declared|\bnone\b/);
      expect(r.out).toMatch(/2 operation/);
      expect(fetchFake.mock.calls[0][0]).toBe('http://app.test/services/api/openapi.json');
      expect(fetchFake.mock.calls[0][1].headers['x-api-key']).toBe('secret-key');
    });

    it('explains an unreachable app instead of crashing', async () => {
      const down = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
      const r = await cli(['routes', '--url', 'http://down.test'], { fetch: down, env: {} });
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/cannot reach/);
    });

    it('writes the TypeScript client to a file', async () => {
      const out = path.join(testDataDir('cli-openapi'), 'client.ts');
      const r = await cli(['openapi', '--url', 'http://app.test', '--client', 'ts', '--out', out], { fetch: fetchFake, env: {} });
      expect(r.code).toBe(0);
      const text = fs.readFileSync(out, 'utf8');
      expect(text).toMatch(/export class NooblyJSClient/);
      expect(text).toMatch(/readonly caching: CachingOperations/);
    });

    it('refuses a client language other than ts', async () => {
      const r = await cli(['openapi', '--client', 'go'], { fetch: fetchFake, env: {} });
      expect(r.code).toBe(2);
    });
  });

  describe('generated TypeScript client', () => {
    it('gives each operation a method on its tag group, with the route and method in the comment', () => {
      const text = generateTypeScriptClient({
        paths: { '/services/caching/api/put/{key}': { post: { tags: ['Caching'], operationId: 'putCache', summary: 'Store */ value' } } }
      });
      expect(text).toMatch(/putCache\(args: NooblyJSCallArgs = \{\}\)/);
      expect(text).toMatch(/POST \/services\/caching\/api\/put\/\{key\}/);
      expect(text).not.toMatch(/\*\/ value/);
    });
  });

  describe('mcp stdio bridge', () => {
    it('posts each line to /services/mcp and writes one answer line per request', async () => {
      const lines = [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      ];
      const fetchFake = jest.fn(async (url, init) => {
        const msg = JSON.parse(init.body);
        if (msg.id === undefined) return { status: 202, text: async () => '' };
        return { status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) };
      });
      const r = await cli(['mcp', '--url', 'http://app.test'], {
        stdin: Readable.from([`${lines.join('\n')}\n`]),
        fetch: fetchFake,
        env: { NOOBLYJS_TOKEN: 'pat' }
      });
      expect(r.code).toBe(0);
      expect(r.out.trim().split('\n')).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}']);
      expect(fetchFake.mock.calls[0][0]).toBe('http://app.test/services/mcp');
      expect(fetchFake.mock.calls[0][1].headers.authorization).toBe('Bearer pat');
    });

    it('reports an unreachable app as a JSON-RPC error for the request that failed', async () => {
      const line = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
      const r = await cli(['mcp', '--url', 'http://down.test'], {
        stdin: Readable.from([`${line}\n`]),
        fetch: async () => { throw new Error('ECONNREFUSED'); },
        env: {}
      });
      const reply = JSON.parse(r.out.trim());
      expect(reply.id).toBe(7);
      expect(reply.error.code).toBe(-32603);
    });

    it('answers a line that is not JSON with a parse error', async () => {
      const r = await cli(['mcp'], { stdin: Readable.from(['{not json\n']), fetch: jest.fn(), env: {} });
      expect(JSON.parse(r.out.trim()).error.code).toBe(-32700);
    });
  });

  describe('create', () => {
    it('writes a runnable API app whose files parse', async () => {
      const dir = path.join(testDataDir('cli-create'), `app-${Date.now()}`);
      const r = await cli(['create', dir, '--yes'], { cwd: os.tmpdir() });
      expect(r.code).toBe(0);
      for (const rel of ['package.json', 'app.js', '.env.example', 'test/app.test.js', 'README.md']) {
        expect(fs.existsSync(path.join(dir, rel))).toBe(true);
      }
      const check = spawnSync(process.execPath, ['--check', path.join(dir, 'app.js')], { encoding: 'utf8' });
      expect(check.status).toBe(0);
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies['nooblyjs-core']).toMatch(/^\^/);
    });

    it('refuses a non-empty directory without --yes, and an unknown template', async () => {
      const dir = path.join(testDataDir('cli-create-refuse'), `busy-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
      expect((await cli(['create', dir])).code).toBe(1);
      expect((await cli(['create', dir, '--template', 'dashboards', '--yes'])).code).toBe(2);
    });

    it('builds the template from the same function the tests inspect', () => {
      const files = apiTemplate('demo');
      expect(JSON.parse(files['package.json']).name).toBe('demo');
    });
  });

  describe('integration: generated client against a running app', () => {
    let server;
    let baseUrl;
    let workDir;

    beforeAll(async () => {
      const registry = require('../../../index');
      const app = express();
      app.use(express.json());
      registry.initialize(app, new EventEmitter(), {
        apiKeys: ['test-key'],
        requireApiKey: true,
        security: { servicesAuth: { requireLogin: false } }
      });
      registry.cache('memory');
      await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      workDir = testDataDir(`cli-client-${Date.now()}`);
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
      require('../../../index').reset?.();
    });

    it('compiles under tsc --strict and stores and reads a value through the client', async () => {
      const tsOut = path.join(workDir, 'client.ts');
      const env = { NOOBLYJS_API_KEY: 'test-key' };
      const gen = await cli(['openapi', '--url', baseUrl, '--client', 'ts', '--out', tsOut], { env });
      expect(gen.code).toBe(0);

      const tsc = require.resolve('typescript/bin/tsc');
      const compiled = spawnSync(process.execPath, [
        tsc, '--strict', '--target', 'ES2020', '--module', 'commonjs', '--lib', 'ES2020',
        '--outDir', path.join(workDir, 'out'), tsOut
      ], { encoding: 'utf8' });
      expect(compiled.stdout + compiled.stderr).toBe('');
      expect(compiled.status).toBe(0);

      const { NooblyJSClient, NooblyJSApiError } = require(path.join(workDir, 'out', 'client.js'));
      const api = new NooblyJSClient({ baseUrl, apiKey: 'test-key' });
      await api.caching.putCache({ path: { key: 'user:1' }, body: { name: 'Ada' } });
      expect(await api.caching.getCache({ path: { key: 'user:1' } })).toEqual({ name: 'Ada' });

      const denied = new NooblyJSClient({ baseUrl, apiKey: 'wrong' });
      await expect(denied.caching.getCache({ path: { key: 'user:1' } })).rejects.toBeInstanceOf(NooblyJSApiError);
    }, 120000);
  });
});
