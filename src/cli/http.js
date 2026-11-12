/**
 * @fileoverview HTTP helpers shared by the commands that talk to a running app.
 * @module cli/http
 */

'use strict';

/**
 * Fetches a URL with the API key, and returns the body text.
 * @param {Object} io Uses io.fetch
 * @param {string} url
 * @param {string=} key
 * @return {Promise<string>}
 */
async function getText(io, url, key) {
  const headers = { accept: 'application/json' };
  if (key) headers['x-api-key'] = key;
  const res = await io.fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    const detail = (() => {
      try { return JSON.parse(text).error || text; } catch { return text; }
    })();
    throw new Error(`${url} answered ${res.status}: ${String(detail).slice(0, 200)}`);
  }
  return text;
}

/**
 * Fetches the OpenAPI document of a running app.
 * @param {Object} io
 * @param {string} base Base URL of the app
 * @param {string=} key
 * @return {Promise<!Object>}
 */
async function fetchDocument(io, base, key) {
  return JSON.parse(await getText(io, `${base.replace(/\/$/, '')}/services/api/openapi.json`, key));
}

/**
 * Names the credentials an operation accepts, or `public`.
 * @param {!Object} op OpenAPI operation
 * @return {string}
 */
function credentialOf(op) {
  const names = (op.security || []).flatMap((requirement) => Object.keys(requirement));
  return names.length ? names.join(' | ') : 'public';
}

module.exports = { getText, fetchDocument, credentialOf };
