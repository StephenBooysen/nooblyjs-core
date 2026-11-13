'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const { app, registry, ready, apiKeys } = require('../app');

// The registry keeps timers open; shut it down so the test process exits.
after(async () => { await registry.shutdown?.(); });

test('the docs are indexed and a question finds the right section', async () => {
  await ready;
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/services/knowledge/api/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKeys[0] },
      body: JSON.stringify({ question: 'rotate the settings secret' })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.match(JSON.stringify(body), /SETTINGS_SECRET/);
  } finally {
    server.close();
  }
});
