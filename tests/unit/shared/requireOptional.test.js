'use strict';

/** @fileoverview Optional peer dependencies (feature 20b). */

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { requireOptional } = require('../../../src/shared/utils/requireOptional');

describe('requireOptional', () => {
  it('returns an installed module', () => {
    expect(requireOptional('express', 'test')).toBe(require('express'));
  });

  it('names the package and the install command when it is missing', () => {
    let error;
    try {
      requireOptional('@nooblyjs-missing/sdk/sub', "queue('test')");
    } catch (err) {
      error = err;
    }
    expect(error.code).toBe('OPTIONAL_DEPENDENCY_MISSING');
    expect(error.packageName).toBe('@nooblyjs-missing/sdk');
    expect(error.message).toBe(`queue('test') needs the optional package "@nooblyjs-missing/sdk". Install it with: npm install @nooblyjs-missing/sdk`);
  });

  it('rethrows errors from inside an installed module', () => {
    const dir = path.join(__dirname, '..', '..', '..', '.temp', 'tests', 'data', 'optional-require');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'broken.js');
    fs.writeFileSync(file, "require('./does-not-exist');\n");
    expect(() => requireOptional(file, 'test')).toThrow(/does-not-exist/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('package.json', () => {
  const pkg = require('../../../package.json');
  const CLOUD = /^(@aws-sdk\/|@azure\/|@google-cloud\/|aws-sdk$|amqplib$|memjs$|mongodb$|stompit$|ftp$|@tensorflow\/)/;

  it('ships no cloud SDK or broker client as a hard dependency', () => {
    expect(Object.keys(pkg.dependencies).filter((d) => CLOUD.test(d))).toEqual([]);
  });

  it('declares every optional peer as optional, and keeps installed ones for the tests', () => {
    for (const name of Object.keys(pkg.peerDependencies)) {
      expect(pkg.peerDependenciesMeta[name]).toEqual({ optional: true });
    }
  });

  it('loads no optional peer when the registry and its services are required', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const script = `
      for (const m of ['./index', './src/caching', './src/aiservice', './src/queueing', './src/authservice',
        './src/filing', './src/dataservice']) require(m);
      process.stdout.write(JSON.stringify(Object.keys(require.cache)));`;
    const loaded = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' }));
    expect(loaded.length).toBeGreaterThan(100);
    const peers = Object.keys(pkg.peerDependencies);
    const offenders = loaded.filter((f) => peers.some((p) => f.includes(`${path.sep}node_modules${path.sep}${p.split('/').join(path.sep)}${path.sep}`)));
    expect(offenders).toEqual([]);
  });
});
