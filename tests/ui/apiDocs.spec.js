/**
 * @fileoverview The API documentation page (feature 10) renders the merged
 * OpenAPI document with Swagger UI and raises no script or CSP errors.
 *
 * Run with: npm run test:ui -- tests/ui/apiDocs.spec.js
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const { test, expect } = require('@playwright/test');

test('API docs page renders the merged document', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) errors.push(`CSP: ${msg.text()}`);
  });

  const response = await page.goto('/services/api/docs');
  expect(response.status()).toBe(200);
  await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#docs-status')).toBeHidden();
  expect(errors).toEqual([]);
});
