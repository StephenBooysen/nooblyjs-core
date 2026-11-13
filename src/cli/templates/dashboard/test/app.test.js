'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { app } = require('../app');

test('health answers ok', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(res.status, 200);
  } finally {
    server.close();
  }
});

test('the dashboards send a signed-out visitor to sign-in', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/services/caching/`, {
      headers: { accept: 'text/html' },
      redirect: 'manual'
    });
    // A signed-out visitor gets the sign-in redirect, not the dashboard.
    const html = await res.text();
    assert.match(html, /authservice\/views\/login\.html/, `expected the sign-in redirect, got ${res.status}`);
  } finally {
    server.close();
  }
});
