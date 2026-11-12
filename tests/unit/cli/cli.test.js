/**
 * @fileoverview The `nooblyjs` command (feature 09) and the typed client it
 * generates (feature 10). The commands run in-process with captured streams;
 * the client is compiled under `strict` and then called against a live app.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { parseArgs } = require('node:util');
const { EventEmitter } = require('events');
const express = require('express');
const ts = require('typescript');

const { main } = require('../../../src/cli');
const { generateTypeScriptClient } = require('../../../src/cli/clientgen');
const { runChecks } = require('../../../src/cli/commands/doctor');
const serviceRegistry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');

const ADMIN_KEY = 'cli-test-admin-key-0123456789abcdef0123456789';

/** Captures what a command writes. */
function capture(extra = {}) {
  const out = [];
  const err = [];
  return {
    out,
    err,
    io: {
      stdout: { write: (s) => { out.push(String(s)); return true; } },
      stderr: { write: (s) => { err.push(String(s)); return true; } },
      stdin: Readable.from([]),
      cwd: extra.cwd || process.cwd(),
      env: extra.env || {},
      fetch: extra.fetch || globalThis.fetch,
      ...extra
    },
    text: () => out.join(''),
    errText: () => err.join('')
  };
}

describe('nooblyjs command (feature 09)', () => {
  let work;

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(testDataDir('cli'), 'cli-'));
  });

  afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('prints usage for --help and fails with no command', async () => {
    const help = capture();
    expect(await main(['--help'], help.io)).toBe(0);
    expect(help.text()).toContain('nooblyjs create');

    const none = capture();
    expect(await main([], none.io)).toBe(1);
  });

  it('rejects an unknown command', async () => {
    const c = capture();
    expect(await main(['launch'], c.io)).toBe(1);
    expect(c.errText()).toContain('unknown command');
  });

  describe('create', () => {
    it('writes a runnable app from the AI template, and its JavaScript parses', async () => {
      const cwd = path.join(work, 'created');
      fs.mkdirSync(cwd, { recursive: true });
      const c = capture({ cwd });
      expect(await main(['create', 'My Shop', '--template', 'ai'], c.io)).toBe(0);

      // The directory keeps the name given; only the npm package name is sanitised.
      const appDir = path.join(cwd, 'My Shop');
      const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
      expect(pkg.name).toBe('my-shop');
      expect(pkg.dependencies['nooblyjs-core']).toMatch(/^\^1\./);
      expect(pkg.scripts.test).toBe('node --test');

      const appSource = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
      expect(() => new vm.Script(appSource)).not.toThrow();
      expect(appSource).toContain("serviceRegistry.aiservice(");
      expect(fs.existsSync(path.join(appDir, 'test', 'app.test.js'))).toBe(true);
      expect(fs.existsSync(path.join(appDir, '.env.example'))).toBe(true);
    });

    it('refuses a non-empty directory unless --force is given', async () => {
      const cwd = path.join(work, 'occupied');
      fs.mkdirSync(path.join(cwd, 'busy'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'busy', 'keep.txt'), 'mine');
      const refused = capture({ cwd });
      expect(await main(['create', 'busy'], refused.io)).toBe(1);
      expect(refused.errText()).toContain('not empty');
      expect(await main(['create', 'busy', '--force'], capture({ cwd }).io)).toBe(0);
    });

    it('rejects an unknown template', async () => {
      const c = capture({ cwd: work });
      expect(await main(['create', 'x-app', '--template', 'blockchain'], c.io)).toBe(2);
      expect(c.errText()).toContain('Unknown template');
    });
  });

  describe('keys', () => {
    it('generates a key of the requested length, and a new one each time', async () => {
      const a = capture();
      expect(await main(['keys', 'generate', '--length', '40'], a.io)).toBe(0);
      const b = capture();
      expect(await main(['keys', 'generate'], b.io)).toBe(0);
      expect(a.text().trim().length).toBeGreaterThanOrEqual(40);
      expect(a.text()).not.toBe(b.text());
    });
  });

  describe('doctor', () => {
    const goodEnv = {
      NODE_ENV: 'production',
      SESSION_SECRET: 'x'.repeat(40),
      API_KEYS: 'key-one-0123456789',
      SETTINGS_SECRET: 'y'.repeat(32),
      TRUST_PROXY: '1'
    };

    it('passes with a complete production environment (audit skipped)', async () => {
      const c = capture({ cwd: work, env: goodEnv });
      expect(await main(['doctor', '--skip-audit'], c.io)).toBe(0);
      expect(c.text()).toContain('All required checks passed');
    });

    it('fails in production when a required secret is missing', async () => {
      const c = capture({ cwd: work, env: { NODE_ENV: 'production' } });
      expect(await main(['doctor', '--skip-audit'], c.io)).toBe(1);
      expect(c.text()).toContain('[FAIL] SESSION_SECRET');
      expect(c.text()).toContain('[FAIL] API keys');
    });

    it('only warns in development, and reports JSON for CI', async () => {
      const checks = runChecks({ dir: work, env: {}, skipAudit: true, spawn: () => ({ status: 0 }) });
      expect(checks.some((c) => c.status === 'fail')).toBe(false);
      expect(checks.some((c) => c.status === 'warn')).toBe(true);

      const c = capture({ cwd: work, env: {} });
      expect(await main(['doctor', '--skip-audit', '--json'], c.io)).toBe(0);
      expect(JSON.parse(c.text()).ok).toBe(true);
    });

    it('fails when npm audit reports a high advisory', () => {
      const checks = runChecks({
        dir: work,
        env: goodEnv,
        skipAudit: false,
        spawn: () => ({ status: 1, stdout: '2 high severity vulnerabilities\n', stderr: '' })
      });
      const audit = checks.find((c) => c.name.startsWith('npm audit'));
      expect(audit.status).toBe('fail');
      expect(audit.detail).toContain('high severity');
    });
  });

  describe('against a running app', () => {
    let server;
    let baseUrl;

    beforeAll(async () => {
      serviceRegistry.reset();
      const app = express();
      app.use(express.json());
      serviceRegistry.initialize(app, new EventEmitter(), {
        logDir: path.join(work, 'app-logs'),
        dataDir: path.join(work, 'app-data'),
        mcp: { enabled: true, allowWrite: true },
        security: {
          apiKeyAuth: { apiKeys: [ADMIN_KEY], requireApiKey: true, excludePaths: ['/services/*/status'] },
          servicesAuth: { requireLogin: false }
        }
      });
      serviceRegistry.logger('memory');
      serviceRegistry.cache('memory');
      serviceRegistry.queue('memory');
      await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
      serviceRegistry.reset();
    });

    it('lists routes with the credentials each needs', async () => {
      const c = capture({ env: { NOOBLYJS_API_KEY: ADMIN_KEY } });
      expect(await main(['routes', '--url', baseUrl], c.io)).toBe(0);
      expect(c.text()).toMatch(/POST\s+\/services\/caching\/api\/put\/\{key\}\s+ApiKeyAuth/);
      expect(c.text()).toMatch(/routes$/m);
    });

    it('reports a clear error when the key is wrong', async () => {
      const c = capture({});
      await expect(main(['routes', '--url', baseUrl, '--key', 'wrong'], c.io)).rejects.toThrow('answered 401');
    });

    it('writes the OpenAPI document as JSON and YAML', async () => {
      const out = path.join(work, 'openapi-out');
      const c = capture({ env: { NOOBLYJS_API_KEY: ADMIN_KEY } });
      expect(await main(['openapi', '--url', baseUrl, '--out', out], c.io)).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(out, 'openapi.json'), 'utf8')).openapi).toBe('3.1.0');

      const y = capture({ env: { NOOBLYJS_API_KEY: ADMIN_KEY } });
      expect(await main(['openapi', '--url', baseUrl, '--format', 'yaml', '--out', out], y.io)).toBe(0);
      expect(fs.readFileSync(path.join(out, 'openapi.yaml'), 'utf8')).toMatch(/^openapi: "3\.1\.0"/m);
    });

    it('generates a TypeScript client that compiles under strict and calls the app', async () => {
      const out = path.join(work, 'client-out');
      const c = capture({ env: { NOOBLYJS_API_KEY: ADMIN_KEY } });
      expect(await main(['openapi', '--url', baseUrl, '--client', 'ts', '--out', out], c.io)).toBe(0);
      const file = path.join(out, 'nooblyjs-client.ts');

      // Compile with strict settings and no ambient types: the client needs none.
      const program = ts.createProgram([file], {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        types: [],
        lib: ['lib.es2020.d.ts']
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(diagnostics).toEqual([]);

      const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
      }).outputText;
      const moduleObject = { exports: {} };
      new Function('exports', 'module', js)(moduleObject.exports, moduleObject);
      const { createNooblyClient, NooblyApiError } = moduleObject.exports;

      const client = createNooblyClient({ baseUrl, apiKey: ADMIN_KEY });
      await client.caching.putCache('user:1', { body: { name: 'Ann' } });
      expect(await client.caching.getCache('user:1')).toEqual({ name: 'Ann' });

      const denied = createNooblyClient({ baseUrl, apiKey: 'nope' });
      await expect(denied.caching.getCache('user:1')).rejects.toBeInstanceOf(NooblyApiError);
    });

    it('bridges MCP over stdio: one reply per request, nothing for notifications', async () => {
      const lines = [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        '{not json'
      ];
      const c = capture({ env: { NOOBLYJS_API_KEY: ADMIN_KEY }, stdin: Readable.from(lines.map((l) => `${l}\n`)) });
      expect(await main(['mcp', '--url', baseUrl], c.io)).toBe(0);
      const replies = c.text().trim().split('\n').map((l) => JSON.parse(l));
      expect(replies).toHaveLength(3);
      expect(replies[0].result.serverInfo.name).toBe('nooblyjs-core');
      expect(replies[1].result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['caching_stats']));
      expect(replies[2].error.code).toBe(-32700);
    });
  });
});

describe('TypeScript client generator (feature 10)', () => {
  it('camel-cases names, escapes path parameters and keeps reserved names apart', () => {
    const src = generateTypeScriptClient({
      paths: {
        '/services/x/api/{options}/items/{id}': { get: { tags: ['x'], operationId: 'getItem', summary: 'Get */ one' } },
        '/services/x/api/list': { get: { tags: ['x'], operationId: 'get-item' } }
      }
    });
    expect(src).toContain('getItem(optionsParam: string, id: string, req: RequestOptions = {})');
    expect(src).toContain('${encodeURIComponent(optionsParam)}/items/${encodeURIComponent(id)}');
    expect(src).toContain('getItem2(req: RequestOptions = {})');
    expect(src).toContain('Get * / one');
  });

  it('parses its own arguments with node:util, so unknown flags are reported', () => {
    expect(() => parseArgs({ args: ['--nope'], options: {}, allowPositionals: false })).toThrow();
  });
});
