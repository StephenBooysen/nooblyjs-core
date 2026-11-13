/**
 * @fileoverview Regression tests for the onboarding exploit chain (review
 * 2026-11-12, finding C-2; feature 16).
 *
 * The reproduced chain was: an anonymous visitor created an auto-approved
 * invitation, received its code in the response, and redeemed it for an
 * active account. These tests assert that a public caller can no longer get a
 * usable code, that codes are stored only as hashes, and that invitations
 * survive a restart with the file provider.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createAuth = require('../../../src/authservice');
const AuthFile = require('../../../src/authservice/providers/authFile');
const { testDataDir } = require('../../helpers/testData');

const PASSWORD = 'Str0ng!Pass#2026';

describe('Security regression: invitation onboarding (C-2)', () => {
  let app;
  let auth;

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    auth = createAuth('memory', { 'express-app': app }, new EventEmitter());
    await auth.createUser({ email: 'admin@x.com', fullName: 'Admin', password: PASSWORD, role: 'admin' });
  });

  it('gives an anonymous visitor no usable code in the default mode', async () => {
    const requested = await request(app)
      .post('/services/authservice/api/invitations')
      .send({ name: 'Mallory', email: 'mallory@example.com' })
      .expect(201);

    expect(requested.body.data.status).toBe('pending');
    expect(JSON.stringify(requested.body)).not.toMatch(/INV-[0-9A-F]{8,}/);

    // Redeeming a guessed code creates no account.
    await request(app)
      .post('/services/authservice/api/invitations/INV-0000000000000000000000000000000000/redeem')
      .send({ password: PASSWORD })
      .expect(400);
    await expect(auth.getUser('mallory@example.com')).rejects.toThrow('User not found');
  });

  it('does not let an anonymous caller list or approve invitations', async () => {
    await request(app).post('/services/authservice/api/invitations').send({ name: 'M', email: 'm@example.com' });

    const list = await request(app).get('/services/authservice/api/invitations');
    expect([401, 403]).toContain(list.status);

    const pending = await request(app).get('/services/authservice/api/invitations');
    expect(pending.text).not.toMatch(/INV-[0-9A-F]{8,}/);
  });

  it('rejects public requests when the mode is admin-only', async () => {
    const adminOnly = express();
    adminOnly.use(express.json());
    createAuth('memory', { 'express-app': adminOnly, invitations: { mode: 'admin-only' } }, new EventEmitter());
    await request(adminOnly)
      .post('/services/authservice/api/invitations')
      .send({ name: 'M', email: 'm@example.com' })
      .expect(403);
  });

  it('refuses an unknown onboarding mode at start-up', () => {
    expect(() => createAuth('memory', { 'express-app': express(), invitations: { mode: 'anyone' } }, new EventEmitter()))
      .toThrow(/Unknown invitations\.mode/);
  });
});

describe('Security regression: invitation persistence and storage (C-2)', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(testDataDir('security-invitations'), 'auth-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** Creates a file auth provider on the shared data directory and waits for it to load. */
  async function openFileAuth() {
    const provider = new AuthFile({ dataDir }, new EventEmitter());
    await provider.initializeFileStorage_();
    return provider;
  }

  it('keeps invitations across a restart and never writes a plain code to disk', async () => {
    const first = await openFileAuth();
    const admin = await first.createInvitation({ name: 'Invitee', email: 'invitee@example.com' });
    const code = admin.code;
    expect(code).toMatch(/^INV-[0-9A-F]{32}$/);

    const onDisk = fs.readFileSync(path.join(dataDir, 'invitations.json'), 'utf8');
    expect(onDisk).not.toContain(code);
    expect(onDisk).toMatch(/"codeHash"/);

    // A fresh provider on the same directory sees the same approved invitation.
    const second = await openFileAuth();
    const status = await second.getInvitation(code);
    expect(status).toEqual(expect.objectContaining({ status: 'approved', email: 'invitee@example.com' }));

    const user = await second.redeemInvitation(code, PASSWORD);
    expect(user.email).toBe('invitee@example.com');
    await expect(second.redeemInvitation(code, PASSWORD)).rejects.toThrow(/invalid|expired|already/i);
  });

  it('stores an invitation redeemed before a restart as used afterwards', async () => {
    const first = await openFileAuth();
    const { code } = await first.createInvitation({ name: 'Once', email: 'once@example.com' });
    await first.redeemInvitation(code, PASSWORD);

    const second = await openFileAuth();
    await expect(second.redeemInvitation(code, PASSWORD)).rejects.toThrow(/invalid|expired|already/i);
  });
});
