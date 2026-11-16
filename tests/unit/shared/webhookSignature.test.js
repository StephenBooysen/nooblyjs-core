'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const {
  captureRawBody,
  signPayload,
  verifyGithub,
  verifyPayload,
  verifySlack,
  verifyStripe,
  verifyWebhook
} = require('../../../src/shared/utils/webhookSignature');

const SECRET = 'whsec_test_secret_0123456789';
const BODY = '{"event":"order.created","id":"o-1"}';

/** Independent reference: HMAC-SHA256 hex, computed with node:crypto directly. */
const reference = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex');

describe('webhook signatures (feature 12)', () => {
  it('signs with the timestamp in the signed text, and verifies', () => {
    const header = signPayload(SECRET, BODY, 1700000000);
    expect(header).toBe(`t=1700000000,v1=${reference(SECRET, `1700000000.${BODY}`)}`);
    expect(verifyPayload(header, BODY, SECRET, { now: 1700000100 })).toEqual({ ok: true });
  });

  it('rejects a replay outside the tolerance window', () => {
    const header = signPayload(SECRET, BODY, 1700000000);
    expect(verifyPayload(header, BODY, SECRET, { now: 1700000000 + 301 })).toEqual({
      ok: false,
      reason: 'timestamp outside tolerance'
    });
    expect(verifyPayload(header, BODY, SECRET, { now: 1700000000 + 301, toleranceSec: 600 })).toEqual({ ok: true });
  });

  it('rejects a changed body, a wrong secret and a tampered timestamp', () => {
    const header = signPayload(SECRET, BODY, 1700000000);
    const now = 1700000000;
    expect(verifyPayload(header, `${BODY} `, SECRET, { now }).ok).toBe(false);
    expect(verifyPayload(header, BODY, 'another-secret-0123456789', { now }).ok).toBe(false);
    const moved = header.replace('t=1700000000', 't=1700000001');
    expect(verifyPayload(moved, BODY, SECRET, { now }).ok).toBe(false);
  });

  it('accepts a header that carries a second v1 value during secret rotation', () => {
    const now = 1700000000;
    const current = signPayload(SECRET, BODY, now);
    const header = `t=${now},v1=${'0'.repeat(64)},${current.split(',')[1]}`;
    expect(verifyPayload(header, BODY, SECRET, { now })).toEqual({ ok: true });
  });

  it('refuses a missing header and a short secret', () => {
    expect(verifyPayload(undefined, BODY, SECRET).reason).toBe('missing signature');
    expect(() => signPayload('short', BODY)).toThrow(/at least 16/);
  });

  it('verifies a GitHub signature against the published example', () => {
    const req = {
      headers: { 'x-hub-signature-256': 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17' },
      rawBody: Buffer.from('Hello, World!')
    };
    expect(verifyGithub(req, "It's a Secret to Everybody")).toEqual({ ok: true });
    expect(verifyGithub({ ...req, rawBody: Buffer.from('Hello, World?') }, "It's a Secret to Everybody").ok).toBe(false);
  });

  it('verifies a Stripe-style header (t and v1 over t.body)', () => {
    const now = 1700000000;
    const header = `t=${now},v1=${reference(SECRET, `${now}.${BODY}`)}`;
    const req = { headers: { 'stripe-signature': header }, rawBody: Buffer.from(BODY) };
    expect(verifyStripe(req, SECRET, { now })).toEqual({ ok: true });
  });

  it('verifies a Slack-style signature (v0 over v0:ts:body) and checks the timestamp', () => {
    const now = 1700000000;
    const header = `v0=${reference(SECRET, `v0:${now}:${BODY}`)}`;
    const req = { headers: { 'x-slack-signature': header, 'x-slack-request-timestamp': String(now) }, rawBody: Buffer.from(BODY) };
    expect(verifySlack(req, SECRET, { now })).toEqual({ ok: true });
    expect(verifySlack(req, SECRET, { now: now + 1000 }).reason).toBe('timestamp outside tolerance');
  });

  it('gives the middleware a 401 for a bad signature and passes a good one through', async () => {
    const app = express();
    app.post('/hook', express.json({ verify: captureRawBody }), verifyWebhook({
      provider: 'nooblyjs',
      secret: SECRET
    }), (req, res) => res.json({ received: req.body.id }));

    const header = signPayload(SECRET, BODY);
    const ok = await request(app).post('/hook').set('content-type', 'application/json')
      .set('NooblyJS-Signature', header).send(BODY).expect(200);
    expect(ok.body.received).toBe('o-1');

    await request(app).post('/hook').set('content-type', 'application/json')
      .set('NooblyJS-Signature', signPayload('wrong-secret-0123456789', BODY))
      .send(BODY).expect(401);
  });

  it('refuses to verify when the raw body was not captured', async () => {
    const app = express();
    app.post('/hook', express.json(), verifyWebhook({ provider: 'github', secret: SECRET }), (req, res) => res.json({}));
    const res = await request(app).post('/hook').set('content-type', 'application/json').send('{}').expect(500);
    expect(res.body.error).toMatch(/Raw body not captured/);
  });
});
