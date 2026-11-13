/**
 * @fileoverview The searching dashboard's match mode (feature 01). Choosing a
 * meaning mode sends the search to the semantic route. The UI test app uses the
 * memory provider, which has no meaning search, so the route answers 400 and the
 * page shows that message, with no script error.
 *
 * Run with: npm run test:ui -- tests/ui/searchingMode.spec.js
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const { test, expect } = require('@playwright/test');

test('meaning mode sends the search to the semantic route', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/services/searching/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#data-tab').click();
  await page.locator('#searchMode').selectOption('semantic');
  await page.locator('#searchTerm').fill('rotate the secret');

  const request = page.waitForRequest((r) => r.url().includes('/services/searching/api/semantic'), { timeout: 15000 });
  await page.locator('#searchForm button[type="submit"]').click();
  const sent = await request;
  expect(sent.url()).toMatch(/mode=semantic/);
  expect(sent.url()).toMatch(/query=rotate\+the\+secret/);
  expect(errors).toEqual([]);
});

test('keyword mode keeps using the keyword route', async ({ page }) => {
  await page.goto('/services/searching/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#data-tab').click();
  await page.locator('#searchMode').selectOption('keyword');
  await page.locator('#searchTerm').fill('plain words');

  const request = page.waitForRequest((r) => r.url().includes('/services/searching/api/search/'), { timeout: 15000 });
  await page.locator('#searchForm button[type="submit"]').click();
  await request;
});
