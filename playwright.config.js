/**
 * @fileoverview Playwright configuration for UI validation tests.
 * Starts the no-auth example app on a dedicated port and runs the specs in
 * tests/ui/ against it with headless Chromium.
 *
 * @author NooblyJS Team
 * @since 1.1.0
 */

'use strict';

const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.UI_TEST_PORT) || 11100;
const BASE_URL = process.env.UI_TEST_BASE_URL || `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/ui',
  outputDir: './.temp/tests/playwright/results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: './.temp/tests/playwright/report', open: 'never' }]
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ],
  // Skip starting a server when pointing at an already-running instance.
  webServer: process.env.UI_TEST_BASE_URL ? undefined : {
    command: 'node ./app-noauth.js',
    url: `${BASE_URL}/services/logging/api/status`,
    env: {
      PORT: String(PORT),
      ALLOW_NOAUTH: '1',
      NOOBLYJS_DATA_ROOT: path.join(__dirname, '.temp', 'tests', 'playwright', 'app-data')
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
