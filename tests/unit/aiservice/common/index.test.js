import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as common from '../../../../src/aiservice/common/index.mjs';
import { costOf } from '../../../../src/aiservice/common/cost.mjs';
import rootPkg from '../../../../package.json' with { type: 'json' };

// The module ships inside the root package, so its entries are the root package.json exports
// that point into src/aiservice/common/. Each one must resolve, and each must be the main entry.
const rootUrl = new URL('../../../../package.json', import.meta.url);
const moduleExports = Object.entries(rootPkg.exports).filter(([, target]) => typeof target === 'string' && target.startsWith('./src/aiservice/common/') && !target.includes('*'));

test('the AI module declares its entries in the root package.json', () => {
  assert.ok(moduleExports.length >= 3, 'the ./ai, ./ai-common and ./src/aiservice/common entries exist');
});

test('the package entry and every AI module export resolve to the main entry', async () => {
  assert.equal(common.costOf, costOf);
  for (const [subpath, target] of moduleExports) {
    const mod = await import(new URL(target, rootUrl).href);
    assert.ok(Object.keys(mod).length, `${subpath} exports something`);
    for (const [name, value] of Object.entries(mod)) assert.equal(common[name], value, `${subpath} ${name} is in the main entry`);
  }
});
