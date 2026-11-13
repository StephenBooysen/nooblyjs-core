/**
 * @fileoverview Regression test for the per-IP login limiter behind a reverse
 * proxy (review 2026-11-12, dependency advisory on proxy-addr; feature 20a).
 *
 * With TRUST_PROXY configured, the limiter must count each real client
 * separately, using the address the proxy forwards. It must not treat every
 * request as coming from the proxy, and a forged header from an untrusted
 * caller must not be able to reset another client's count.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createAuth = require('../../../src/authservice');

/** Default per-IP login limit (LOGIN_RATE_LIMIT_MAX). */
const LIMIT = 10;

/**
 * Sends one failed login from a forwarded client address.
 *
 * @param {express.Application} app
 * @param {string} forwardedFor - The client address the proxy reports
 * @param {number} attempt - Used to vary the email, so per-account lockout stays out of the way
 * @return {Promise<import('supertest').Response>}
 */
function failedLogin(app, forwardedFor, attempt) {
  return request(app)
    .post('/services/authservice/api/login')
    .set('X-Forwarded-For', forwardedFor)
    .send({ email: `nobody${attempt}@example.com`, password: 'wrong-password-1' });
}

describe('Security regression: login limiter behind a trusted proxy (feature 20a)', () => {
  it('counts each forwarded client separately when the proxy is trusted', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    createAuth('memory', { 'express-app': app }, new EventEmitter());

    for (let i = 0; i < LIMIT; i++) {
      const res = await failedLogin(app, '203.0.113.7', i);
      expect(res.status).not.toBe(429);
    }
    expect((await failedLogin(app, '203.0.113.7', LIMIT)).status).toBe(429);

    // A different client behind the same proxy still has its full allowance.
    const other = await failedLogin(app, '198.51.100.9', 100);
    expect(other.status).not.toBe(429);
  });

  it('ignores forwarded headers from an untrusted caller', async () => {
    const app = express();
    app.use(express.json());
    createAuth('memory', { 'express-app': app }, new EventEmitter());

    // Without trust, every attempt is keyed by the socket address, so rotating
    // the forwarded header cannot reset the count.
    for (let i = 0; i < LIMIT; i++) {
      await failedLogin(app, `192.0.2.${i + 1}`, i);
    }
    expect((await failedLogin(app, '192.0.2.250', LIMIT)).status).toBe(429);
  });
});
