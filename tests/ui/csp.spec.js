/**
 * @fileoverview Strict CSP checks for the dashboards (feature 17b).
 *
 * - The policy served with every dashboard allows no inline script: script-src
 *   has no 'unsafe-inline' and script-src-attr is 'none'.
 * - Every element that uses data-onclick names a function the page defines, so
 *   a click cannot fail silently after a rename.
 * - A converted click works: the page's own handler runs with no CSP error.
 *
 * Run with: npm run test:ui -- tests/ui/csp.spec.js
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const { test, expect } = require('@playwright/test');

/** The dashboards mounted by app-noauth.js. */
const SERVICE_PATHS = [
  'logging', 'caching', 'queueing', 'fetching', 'settings',
  'notifying', 'dataservice', 'working', 'measuring',
  'scheduling', 'searching', 'workflow', 'filing',
  'authservice', 'ai'
];

test('the served policy forbids inline script and inline handlers', async ({ request }) => {
  const response = await request.get('/services/logging/');
  const csp = response.headers()['content-security-policy'] || '';
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] || '';
  const scriptSrcAttr = /script-src-attr ([^;]*)/.exec(csp)?.[1] || '';
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrcAttr).toBe("'none'");
});

for (const service of SERVICE_PATHS) {
  test(`${service}: every data-onclick names a function the page defines`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) pageErrors.push(`CSP: ${msg.text()}`);
    });
    // A page script that fails to load leaves its handlers undefined: treat it as an error.
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script' && response.status() >= 400) {
        pageErrors.push(`script ${response.status()}: ${new URL(response.url()).pathname}`);
      }
    });
    // 'load' waits for every page script; 'networkidle' can stall on external CDN requests.
    await page.goto(`/services/${service}/`, { waitUntil: 'load' });

    const missing = await page.evaluate(() => {
      const names = new Set();
      document.querySelectorAll('[data-onclick]').forEach((el) => names.add(el.getAttribute('data-onclick')));
      const unresolved = [];
      for (const name of names) {
        let target = window;
        for (const part of name.split('.')) target = target == null ? undefined : target[part];
        if (typeof target !== 'function') unresolved.push(name);
      }
      return unresolved;
    });
    expect(missing).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test('a converted button runs the page handler with no CSP error', async ({ page }) => {
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) pageErrors.push(msg.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/services/dataservice/', { waitUntil: 'load' });

  // Sorting a table header calls sortTable(name) through data-onclick.
  const header = page.locator('th[data-onclick="sortTable"]').first();
  await expect(header).toHaveCount(1);
  await header.click();
  expect(pageErrors).toEqual([]);
});
