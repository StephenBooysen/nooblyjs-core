/**
 * @fileoverview Phase 0 close-out regression tests (features 16, 20a, 22a).
 *
 * Covers the items the roadmap listed as open before tagging 1.0.11:
 *   - invitation codes are revoked after too many failed redeems;
 *   - invitations survive a restart with the file provider, and codes are not
 *     stored in plaintext;
 *   - domain-allowlist requests send the code to the address entered and never
 *     return it in the response;
 *   - the mail transport sends invitation codes (nodemailer optional);
 *   - the login rate limiter keys on the client IP behind TRUST_PROXY, and
 *     ignores X-Forwarded-For when no proxy is trusted.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.11
 */

'use strict';

// Low bcrypt cost keeps the suite fast; set before the providers load.
process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('events');
const express = require('express');
const request = require('supertest');

const AuthFile = require('../../../src/authservice/providers/authFile');
const createAuth = require('../../../src/authservice');
const { createMailer, invitationCodeSender } = require('../../../src/notifying/modules/mail');
const { testDataDir } = require('../../helpers/testData');

const PASSWORD = 'Str0ng!Pass#2026';
const WEAK = 'weak';

/** Creates a file provider and waits for its storage to load. */
function openFileAuth(dataDir, options = {}) {
  const events = new EventEmitter();
  jest.spyOn(events, 'emit');
  const ready = new Promise((resolve, reject) => {
    events.once('auth:file-storage-initialized', resolve);
    events.once('auth:file-storage-error', (e) => reject(new Error(e.error)));
  });
  const auth = new AuthFile({ dataDir, ...options }, events);
  return ready.then(() => ({ auth, events }));
}

describe('Phase 0 close-out', () => {
  const savedEnv = {};
  const ENV_KEYS = ['SMTP_URL', 'MAIL_FROM', 'LOGIN_RATE_LIMIT_MAX', 'LOGIN_RATE_WINDOW_MS', 'DEFAULT_ADMIN_PASSWORD'];
  let dir;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = fs.mkdtempSync(path.join(testDataDir('auth'), 'nooblyjs-phase0-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('failed redeem counter (feature 16)', () => {
    it('revokes the code after the configured number of failed redeems', async () => {
      const { auth, events } = await openFileAuth(dir, { invitations: { maxFailedRedeems: 2 } });
      const created = await auth.createInvitation({ name: 'Ann', email: 'ann@counter.test' });

      await expect(auth.redeemInvitation(created.code, WEAK)).rejects.toThrow('Password does not meet strength');
      await expect(auth.redeemInvitation(created.code, WEAK)).rejects.toThrow('has been revoked');

      // The revoked code no longer works, even with a strong password.
      await expect(auth.redeemInvitation(created.code, PASSWORD)).rejects.toThrow('Invitation not found');
      expect(events.emit).toHaveBeenCalledWith('auth:invitation-revoked', expect.objectContaining({
        email: 'ann@counter.test',
        reason: 'too-many-failed-redeems'
      }));
    });

    it('lets an administrator issue a fresh code that starts with a clean count', async () => {
      const { auth } = await openFileAuth(dir, { invitations: { maxFailedRedeems: 2 } });
      const created = await auth.createInvitation({ name: 'Bo', email: 'bo@counter.test' });
      await expect(auth.redeemInvitation(created.code, WEAK)).rejects.toThrow();
      await expect(auth.redeemInvitation(created.code, WEAK)).rejects.toThrow('has been revoked');

      const fresh = await auth.recreateInvitation(created.id);
      const user = await auth.redeemInvitation(fresh.code, PASSWORD);
      expect(user.email).toBe('bo@counter.test');
    });
  });

  describe('persistence and hashing (feature 16)', () => {
    it('keeps invitations across a restart and stores no plaintext code', async () => {
      const first = await openFileAuth(dir);
      const created = await first.auth.createInvitation({ name: 'Cy', email: 'cy@persist.test' });

      const onDisk = fs.readFileSync(path.join(dir, 'invitations.json'), 'utf8');
      expect(onDisk).not.toContain(created.code);
      expect(onDisk).toContain('cy@persist.test');

      // A new provider over the same directory is a restart.
      const second = await openFileAuth(dir);
      const user = await second.auth.redeemInvitation(created.code, PASSWORD);
      expect(user.email).toBe('cy@persist.test');
      // A used code is no longer indexed, so a replay looks like an unknown code.
      await expect(second.auth.redeemInvitation(created.code, PASSWORD)).rejects.toThrow('Invitation not found');
    });
  });

  describe('domain-allowlist delivery (feature 16)', () => {
    it('emails the code to the entered address and never returns it', async () => {
      const sendCode = jest.fn(async () => {});
      const { auth } = await openFileAuth(dir, {
        invitations: { mode: 'domain-allowlist', allowedDomains: ['corp.test'], sendCode }
      });

      const response = await auth.requestInvitation({ name: 'Dee', email: 'dee@corp.test' });
      expect(response.status).toBe('sent');
      expect(response.code).toBeUndefined();
      expect(sendCode).toHaveBeenCalledTimes(1);
      const sent = sendCode.mock.calls[0][0];
      expect(sent.email).toBe('dee@corp.test');
      expect(sent.code).toMatch(/^INV-[0-9A-F]{20}$/);

      const user = await auth.redeemInvitation(sent.code, PASSWORD);
      expect(user.email).toBe('dee@corp.test');
    });

    it('leaves other domains pending for approval', async () => {
      const sendCode = jest.fn(async () => {});
      const { auth } = await openFileAuth(dir, {
        invitations: { mode: 'domain-allowlist', allowedDomains: ['corp.test'], sendCode }
      });
      const response = await auth.requestInvitation({ name: 'Eve', email: 'eve@elsewhere.test' });
      expect(response.status).toBe('pending');
      expect(response.code).toBeUndefined();
      expect(sendCode).not.toHaveBeenCalled();
    });
  });

  describe('mail transport (feature 16, nodemailer optional)', () => {
    it('returns no mailer when neither SMTP_URL nor a transport is configured', () => {
      expect(createMailer({})).toBeNull();
    });

    it('sends through the transport with the configured sender', async () => {
      const transport = { sendMail: jest.fn(async () => {}) };
      const mailer = createMailer({ transport, from: 'NooblyJS <no-reply@example.test>' });
      await mailer.send({ to: 'x@example.test', subject: 'Hi', text: 'Hello' });
      expect(transport.sendMail).toHaveBeenCalledWith({
        from: 'NooblyJS <no-reply@example.test>',
        to: 'x@example.test',
        subject: 'Hi',
        text: 'Hello'
      });
    });

    it('refuses to send without a sender address', async () => {
      const mailer = createMailer({ transport: { sendMail: jest.fn() } });
      await expect(mailer.send({ to: 'x@example.test', subject: 'Hi', text: 'Hello' }))
        .rejects.toThrow('MAIL_FROM');
    });

    it('builds an invitation sender that puts the code in the message', async () => {
      const transport = { sendMail: jest.fn(async () => {}) };
      const mailer = createMailer({ transport, from: 'no-reply@example.test' });
      const sendCode = invitationCodeSender(mailer, { appName: 'Test App' });
      await sendCode({ email: 'z@example.test', name: 'Zed', code: 'INV-ABC', expiresAt: new Date(0) });
      const message = transport.sendMail.mock.calls[0][0];
      expect(message.to).toBe('z@example.test');
      expect(message.subject).toBe('Your Test App invitation code');
      expect(message.text).toContain('INV-ABC');
    });
  });

  describe('login rate limiter behind TRUST_PROXY (feature 20a)', () => {
    /**
     * Makes `count` failed logins from one client IP, each with a different
     * email so the per-account lockout does not interfere.
     */
    async function failLogins(app, ip, count, tag) {
      const statuses = [];
      for (let i = 0; i < count; i += 1) {
        const res = await request(app)
          .post('/services/authservice/api/login')
          .set('X-Forwarded-For', ip)
          .send({ email: `${tag}${i}@ratelimit.test`, password: 'wrong' });
        statuses.push(res.status);
      }
      return statuses;
    }

    function buildApp(trustProxy) {
      process.env.LOGIN_RATE_LIMIT_MAX = '3';
      const app = express();
      if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
      app.use(express.json());
      createAuth('memory', { 'express-app': app }, new EventEmitter());
      return app;
    }

    it('counts each forwarded client separately when the proxy is trusted', async () => {
      const app = buildApp(1);
      expect(await failLogins(app, '10.0.0.1', 3, 'a')).toEqual([401, 401, 401]);
      expect(await failLogins(app, '10.0.0.1', 1, 'a-more')).toEqual([429]);
      // A different client behind the same proxy has its own budget.
      expect(await failLogins(app, '10.0.0.2', 1, 'b')).toEqual([401]);
    });

    it('ignores X-Forwarded-For when no proxy is trusted', async () => {
      // express-rate-limit warns that the header is present without a trusted
      // proxy; that warning is the point of this test, so keep it quiet.
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const app = buildApp(undefined);
      // Every request comes from the same socket address, whatever the header says.
      expect(await failLogins(app, '10.0.0.1', 3, 'c')).toEqual([401, 401, 401]);
      expect(await failLogins(app, '10.0.0.2', 1, 'd')).toEqual([429]);
      errorSpy.mockRestore();
    });
  });
});
