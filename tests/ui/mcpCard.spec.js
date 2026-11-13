/**
 * @fileoverview The MCP card on the services dashboard (feature 03) renders
 * from the status endpoint and raises no script or CSP errors.
 *
 * Run with: npm run test:ui -- tests/ui/mcpCard.spec.js
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const { test, expect } = require('@playwright/test');

test('services dashboard shows the MCP card', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) errors.push(`CSP: ${msg.text()}`);
  });

  await page.goto('/services/');
  const card = page.locator('#mcp-card .card');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText('MCP server for coding agents');
  expect(errors).toEqual([]);
});
