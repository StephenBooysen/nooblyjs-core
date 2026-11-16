'use strict';

/**
 * @fileoverview Webhook signing and verification (feature 12).
 *
 * Outbound deliveries carry `NooblyJS-Signature: t=<unix seconds>,v1=<hex>`,
 * where v1 is HMAC-SHA256 over `<t>.<raw body>`. Including the timestamp in the
 * signed text stops a captured delivery from being replayed later: receivers
 * reject timestamps outside the tolerance window.
 *
 * Inbound verifiers for Stripe, GitHub and Slack follow each provider's
 * published scheme. Every comparison is constant time.
 *
 * @module shared/utils/webhookSignature
 */

const crypto = require('node:crypto');

/** Header carrying NooblyJS signatures. */
const SIGNATURE_HEADER = 'NooblyJS-Signature';

/** Default replay window, in seconds. */
const DEFAULT_TOLERANCE_SEC = 300;

/**
 * Turns a body into the bytes that are signed.
 *
 * @param {string|Buffer} body Raw body
 * @return {Buffer}
 */
function toBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  throw new TypeError('A webhook body must be a string or a Buffer');
}

/**
 * HMAC-SHA256 as hex.
 *
 * @param {string} secret Signing secret
 * @param {Buffer} message Bytes to sign
 * @return {string} Lower-case hex digest
 */
function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Compares two strings without leaking where they differ.
 *
 * @param {string} a First value
 * @param {string} b Second value
 * @return {boolean}
 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Builds the NooblyJS signature header for a body.
 *
 * @param {string} secret Signing secret
 * @param {string|Buffer} body Raw body
 * @param {number=} timestamp Unix seconds (default: now)
 * @return {string} Header value, for example `t=1700000000,v1=ab12…`
 */
function signPayload(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('A webhook secret must be a string of at least 16 characters');
  }
  const bytes = toBuffer(body);
  const signature = hmacHex(secret, Buffer.concat([Buffer.from(`${timestamp}.`), bytes]));
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verifies a NooblyJS signature.
 *
 * @param {string} header Value of the NooblyJS-Signature header
 * @param {string|Buffer} body Raw body
 * @param {string} secret Signing secret
 * @param {Object=} options
 * @param {number=} options.toleranceSec Replay window (default 300 seconds)
 * @param {number=} options.now Unix seconds for the check (default: now)
 * @return {{ok: boolean, reason?: string}}
 */
function verifyPayload(header, body, secret, options = {}) {
  const tolerance = options.toleranceSec === undefined ? DEFAULT_TOLERANCE_SEC : options.toleranceSec;
  const now = options.now === undefined ? Math.floor(Date.now() / 1000) : options.now;
  if (typeof header !== 'string') return { ok: false, reason: 'missing signature' };

  const parts = Object.fromEntries(header.split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || timestamp <= 0) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: 'timestamp outside tolerance' };

  const expected = hmacHex(secret, Buffer.concat([Buffer.from(`${timestamp}.`), toBuffer(body)]));
  const candidates = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const ok = candidates.some((candidate) => safeEqual(candidate, expected));
  return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Verifies a Stripe `Stripe-Signature` header (`t=…,v1=…`, HMAC over `t.body`).
 *
 * @param {Object} req Express request with rawBody
 * @param {string} secret Endpoint secret
 * @param {Object=} options See verifyPayload
 * @return {{ok: boolean, reason?: string}}
 */
function verifyStripe(req, secret, options) {
  return verifyPayload(req.headers['stripe-signature'], req.rawBody, secret, options);
}

/**
 * Verifies a GitHub `X-Hub-Signature-256` header (`sha256=<hex>`, HMAC over the body).
 * GitHub sends no timestamp, so there is no replay window.
 *
 * @param {Object} req Express request with rawBody
 * @param {string} secret Webhook secret
 * @return {{ok: boolean, reason?: string}}
 */
function verifyGithub(req, secret) {
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return { ok: false, reason: 'missing signature' };
  const expected = hmacHex(secret, toBuffer(req.rawBody));
  return safeEqual(header.slice(7), expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Verifies a Slack `X-Slack-Signature` header (`v0=<hex>`, HMAC over `v0:<ts>:<body>`).
 *
 * @param {Object} req Express request with rawBody
 * @param {string} secret Signing secret
 * @param {Object=} options See verifyPayload (tolerance applies to the timestamp header)
 * @return {{ok: boolean, reason?: string}}
 */
function verifySlack(req, secret, options = {}) {
  const header = req.headers['x-slack-signature'];
  const timestamp = Number(req.headers['x-slack-request-timestamp']);
  if (typeof header !== 'string' || !Number.isInteger(timestamp)) return { ok: false, reason: 'missing signature' };
  const tolerance = options.toleranceSec === undefined ? DEFAULT_TOLERANCE_SEC : options.toleranceSec;
  const now = options.now === undefined ? Math.floor(Date.now() / 1000) : options.now;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = hmacHex(secret, Buffer.concat([Buffer.from(`v0:${timestamp}:`), toBuffer(req.rawBody)]));
  return safeEqual(header.replace(/^v0=/, ''), expected) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Verifier for a provider name.
 *
 * @param {'nooblyjs'|'stripe'|'github'|'slack'} provider
 * @return {function(Object, string, Object=): {ok: boolean, reason?: string}}
 */
function verifierFor(provider) {
  switch (provider) {
    case 'nooblyjs':
      return (req, secret, options) => verifyPayload(req.headers[SIGNATURE_HEADER.toLowerCase()], req.rawBody, secret, options);
    case 'stripe': return verifyStripe;
    case 'github': return verifyGithub;
    case 'slack': return verifySlack;
    default: throw new Error(`Unknown webhook provider: ${provider}`);
  }
}

/**
 * Express middleware that rejects a request whose signature does not verify.
 * It needs the raw body, so mount `captureRawBody` on the JSON parser first:
 * `express.json({ verify: captureRawBody })`.
 *
 * @param {Object} options
 * @param {'nooblyjs'|'stripe'|'github'|'slack'} options.provider Scheme to check
 * @param {string|function(): string} options.secret Secret, or a function that returns it
 * @param {number=} options.toleranceSec Replay window in seconds
 * @return {function(import('express').Request, import('express').Response, import('express').NextFunction): void}
 */
function verifyWebhook(options) {
  const verify = verifierFor(options.provider);
  return function webhookVerifier(req, res, next) {
    if (!Buffer.isBuffer(req.rawBody) && typeof req.rawBody !== 'string') {
      return res.status(500).json({ success: false, error: 'Raw body not captured; use express.json({ verify: captureRawBody })' });
    }
    const secret = typeof options.secret === 'function' ? options.secret() : options.secret;
    if (!secret) return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
    const result = verify(req, secret, { toleranceSec: options.toleranceSec });
    if (!result.ok) {
      return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
    }
    return next();
  };
}

/**
 * `verify` callback for express.json() that keeps the raw bytes.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Buffer} buf Raw body
 * @return {void}
 */
function captureRawBody(req, res, buf) {
  req.rawBody = buf;
}

module.exports = {
  DEFAULT_TOLERANCE_SEC,
  SIGNATURE_HEADER,
  captureRawBody,
  signPayload,
  verifyGithub,
  verifyPayload,
  verifySlack,
  verifyStripe,
  verifyWebhook
};
