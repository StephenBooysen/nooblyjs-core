/**
 * @fileoverview The package's documented entry points are exported and point at
 * files that exist. With an `exports` map, a subpath that is not listed cannot be
 * required at all (`ERR_PACKAGE_PATH_NOT_EXPORTED`), so `nooblyjs-core/testing`
 * (feature 11) and the other entries must stay in the map and in `files`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const pkg = require('../../package.json');

const DOCUMENTED = ['.', './testing', './ai-common', './shell', './store', './route-pattern'];

describe('package exports', () => {
  it.each(DOCUMENTED)('exports %s to a file that exists and is published', (subpath) => {
    const entry = pkg.exports[subpath];
    expect(entry).toBeDefined();
    const target = typeof entry === 'string' ? entry : entry.default;
    expect(fs.existsSync(path.join(ROOT, target))).toBe(true);
    const top = target.replace(/^\.\//, '').split('/')[0];
    expect(pkg.files).toContain(top);
  });

  it('resolves nooblyjs-core/testing by package name, as an app would', () => {
    // A child process, because Jest's resolver is not the one apps use.
    const out = execFileSync(process.execPath, ['-e', "console.log(Object.keys(require('nooblyjs-core/testing')).join(','))"], { cwd: ROOT, encoding: 'utf8' });
    expect(out.trim().split(',')).toEqual(expect.arrayContaining(['createTestRegistry', 'installMatchers']));
  });
});
