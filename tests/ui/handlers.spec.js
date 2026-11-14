/**
 * @fileoverview Every click handler a dashboard can render resolves (feature
 * 17b). Since the strict CSP, buttons name their handler in `data-onclick` and
 * `/services/js/actions.js` calls the global function of that name; a typo or a
 * function that is not global fails silently. For each page this test collects
 * every handler name from the page's HTML and from every script it loaded
 * (including template strings for buttons rendered later), then checks that each
 * name resolves to a function on `window` once the page has loaded. Every
 * same-origin script must also load as JavaScript: a script that 404s raises no
 * page error, yet every handler in it is missing.
 *
 * Run with: npm run test:ui -- tests/ui/handlers.spec.js
 */

'use strict';

const { test, expect } = require('@playwright/test');

const PAGES = [
  '/services/',
  '/services/api/docs',
  ...['logging', 'caching', 'queueing', 'fetching', 'settings', 'notifying', 'dataservice', 'working',
    'measuring', 'scheduling', 'searching', 'workflow', 'filing', 'authservice', 'ai', 'knowledge']
    .map((s) => `/services/${s}/`),
  ...['profile', 'login', 'register', 'request-invitation', 'redeem-invitation', 'invalid']
    .map((p) => `/services/authservice/views/${p}.html`)
];

/** Handled by actions.js itself, not by a page function. */
const BUILT_IN = new Set(['navigateTo', 'reloadPage', 'location.reload']);
const NAME = /data-onclick=\\?["']([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\\?["']/g;

/**
 * Handler names written in a piece of HTML or JavaScript. Block comments and
 * whole-line comments are dropped first, so usage examples in doc comments
 * (actions.js shows `data-onclick="deleteItem"`) are not taken for handlers.
 */
function handlerNames(text) {
  const code = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return [...code.matchAll(NAME)].map((m) => m[1]).filter((n) => !BUILT_IN.has(n));
}

for (const url of PAGES) {
  test(`every data-onclick handler on ${url} resolves`, async ({ page, request }) => {
    const response = await page.goto(url);
    expect(response.status()).toBe(200);
    await page.waitForLoadState('networkidle');

    const html = await response.text();
    const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter(Boolean));
    const sources = [html];
    const broken = [];
    for (const src of scripts) {
      if (new URL(src).origin !== new URL(page.url()).origin) continue; // CDN libraries
      const res = await request.get(src);
      // A page script that 404s raises no page error, but every handler in it is missing.
      if (res.status() !== 200 || !/javascript/.test(res.headers()['content-type'] || '')) {
        broken.push(`${new URL(src).pathname} ${res.status()} ${res.headers()['content-type'] || ''}`);
      }
      sources.push(await res.text());
    }
    expect({ url, broken }).toEqual({ url, broken: [] });
    sources.push(await page.content()); // buttons the page has rendered so far
    const names = [...new Set(sources.flatMap(handlerNames))].sort();

    const missing = await page.evaluate((list) => list.filter((name) => {
      let scope = window;
      for (const part of name.split('.')) scope = scope?.[part];
      return typeof scope !== 'function';
    }), names);
    expect({ url, missing }).toEqual({ url, missing: [] });
  });
}
