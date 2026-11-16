'use strict';

/**
 * @fileoverview Packaging checks for the dual CommonJS/ESM entry points (feature 14).
 * The wrappers in esm/ are generated; these tests fail when they drift, when an
 * exports target is missing, or when ESM named exports stop matching the registry.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pkg = require('../../../package.json');

const ROOT = path.join(__dirname, '..', '..', '..');
const run = (args, options = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000, ...options });

describe('dual CommonJS/ESM entry points (feature 14)', () => {
  it('keeps the generated ESM wrappers in step with their CommonJS targets', () => {
    const res = run(['scripts/generate-esm.js', '--check']);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('points every export condition at a file that exists', () => {
    const targets = [];
    const collect = (value) => {
      if (typeof value === 'string') targets.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(pkg.exports);
    const missing = targets.filter((t) => t.includes('*') ? false : !fs.existsSync(path.join(ROOT, t)));
    expect(missing).toEqual([]);
  });

  it('publishes the esm folder', () => {
    expect(pkg.files).toContain('esm');
  });

  it('exposes the registry methods as named ESM exports, bound to the singleton', () => {
    const script = `
      const mod = await import('nooblyjs-core');
      const cjs = (await import('node:module')).createRequire(process.cwd() + '/')('nooblyjs-core');
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(cjs))
        .filter((n) => n !== 'constructor' && !n.startsWith('_') && !n.endsWith('_') && typeof cjs[n] === 'function');
      const missing = methods.filter((n) => typeof mod[n] !== 'function');
      console.log(JSON.stringify({ isDefault: mod.default === cjs, missing, count: methods.length }));
    `;
    const res = run(['--input-type=module', '-e', script]);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim().split('\n').pop());
    expect(out.isDefault).toBe(true);
    expect(out.missing).toEqual([]);
    expect(out.count).toBeGreaterThan(20);
  });

  it('serves the store, shell and route-pattern subpaths to both module systems', () => {
    const script = `
      const store = await import('nooblyjs-core/store');
      const shell = await import('nooblyjs-core/shell');
      const route = await import('nooblyjs-core/route-pattern');
      console.log(JSON.stringify({ store: typeof store.FsStore, shell: Object.keys(shell).length > 0, route: typeof route.route }));
    `;
    const res = run(['--input-type=module', '-e', script]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout.trim().split('\n').pop())).toEqual({ store: 'function', shell: true, route: 'function' });
    const cjs = run(['-e', "const s=require('nooblyjs-core/store'); const r=require('nooblyjs-core/route-pattern'); console.log(typeof s.FsStore, typeof r.route)"]);
    expect(cjs.stdout.trim()).toBe('function function');
  });
});
