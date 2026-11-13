/**
 * @fileoverview Click dispatch for dashboards (feature 17b). Converted buttons
 * call their named handler with the JSON arguments, buttons added after load
 * work too, and a malformed arguments attribute runs nothing.
 *
 * Run with: npm run test:ui -- tests/ui/actions.spec.js
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const { test, expect } = require('@playwright/test');

test.describe('data-onclick dispatcher', () => {
  test('a rendered page button calls its handler', async ({ page }) => {
    await page.goto('/services/caching/');
    await page.waitForLoadState('domcontentloaded');
    // Plain function names only: the sidebar's dotted names are covered by the navigation tests.
    const button = page.locator('[data-onclick]:not([data-onclick*="."]):visible').first();
    await expect(button).toBeVisible();
    const name = await button.getAttribute('data-onclick');
    const expected = JSON.parse((await button.getAttribute('data-onclick-args')) || '[]');
    await page.evaluate((fn) => {
      window.__probe = [];
      window[fn] = (...a) => window.__probe.push(a);
    }, name);
    await button.click();
    const [args] = await page.evaluate(() => window.__probe);
    expect(args).toEqual(expect.arrayContaining(expected.filter((a) => typeof a !== 'object')));
  });

  test('buttons added later pass their JSON arguments', async ({ page }) => {
    await page.goto('/services/caching/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      window.__probe = [];
      window.probeHandler = (...a) => window.__probe.push([a[0], a[1], a[2] && a[2].id]);
      const b = document.createElement('button');
      b.setAttribute('data-onclick', 'probeHandler');
      b.setAttribute('data-onclick-args', JSON.stringify(['a "quoted" value', 2, { $this: true }]));
      b.id = 'probe-btn';
      document.body.appendChild(b);
    });
    await page.click('#probe-btn');
    const [args] = await page.evaluate(() => window.__probe);
    expect(args).toEqual(['a "quoted" value', 2, 'probe-btn']);
  });

  test('a malformed arguments attribute runs nothing', async ({ page }) => {
    await page.goto('/services/caching/');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      window.__probe = [];
      window.probeHandler = () => window.__probe.push('ran');
      const b = document.createElement('button');
      b.setAttribute('data-onclick', 'probeHandler');
      b.setAttribute('data-onclick-args', '{not json');
      b.id = 'bad-btn';
      document.body.appendChild(b);
    });
    await page.click('#bad-btn');
    expect(await page.evaluate(() => window.__probe)).toEqual(['ran']);
  });
});
