'use strict';

/**
 * @fileoverview Every named export of an ESM wrapper has a declaration in the
 * matching `.d.mts` file, so TypeScript users get the same names the runtime has.
 */

const fs = require('node:fs');
const path = require('node:path');

const ESM_DIR = path.join(__dirname, '..', '..', '..', 'esm');
const WRAPPERS = ['index', 'testing', 'store', 'shell', 'route-pattern'];

/** Names exported with `export const NAME` or `export class NAME` / `export function NAME` in a file. */
function namedExports(text) {
  const names = new Set();
  for (const match of text.matchAll(/^export (?:declare )?(?:const|let|class|function) (\w+)/gm)) names.add(match[1]);
  return names;
}

describe('ESM wrapper typings (feature 14)', () => {
  it.each(WRAPPERS.map((name) => [name]))('%s.d.mts declares every named export of its .mjs wrapper', (name) => {
    const runtime = namedExports(fs.readFileSync(path.join(ESM_DIR, `${name}.mjs`), 'utf8'));
    const declared = namedExports(fs.readFileSync(path.join(ESM_DIR, `${name}.d.mts`), 'utf8'));
    expect(runtime.size).toBeGreaterThan(0);
    const missing = [...runtime].filter((n) => !declared.has(n));
    expect(missing).toEqual([]);
  });
});
