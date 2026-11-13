/**
 * @fileoverview Session-cookie sign-in for the browser (feature 23).
 *
 * The dashboards and login pages must not keep the session token in browser
 * storage, and the auth/check route tells a page whether its cookie is signed in.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const registry = require('../../../index');

describe('GET /services/authservice/api/auth/check (feature 23)', () => {
  let signedInUser = null;
  let app;

  beforeAll(() => {
    app = express();
    // Stand-in for Passport's session: the test chooses who is signed in.
    app.use((req, res, next) => {
      req.isAuthenticated = () => Boolean(signedInUser);
      req.user = signedInUser;
      next();
    });
    registry.initialize(app, new EventEmitter(), { apiKeys: ['k'], security: { servicesAuth: { requireLogin: false } } });
    registry.authservice('memory', {});
    registry.logger('memory');
  });
  afterAll(async () => {
    await registry.shutdown?.();
    registry.reset?.();
  });

  it('reports an anonymous caller as not authenticated, without a user', async () => {
    signedInUser = null;
    const res = await request(app).get('/services/authservice/api/auth/check').expect(200);
    expect(res.body).toEqual({ success: true, authenticated: false, user: null });
  });

  it('reports a signed-in user with email, name and roles, and never a token', async () => {
    signedInUser = { email: 'ada@example.com', fullName: 'Ada', roles: ['editor'], passwordHash: 'x' };
    const res = await request(app).get('/services/authservice/api/auth/check').expect(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual({ email: 'ada@example.com', fullName: 'Ada', roles: ['editor'] });
    expect(JSON.stringify(res.body)).not.toMatch(/token|passwordHash/i);
    signedInUser = null;
  });
});

describe('no auth token in browser storage (feature 23)', () => {
  const SRC = path.join(__dirname, '..', '..', '..', 'src');
  const SCAN = /\.(html|js)$/;

  function listFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') listFiles(full, out);
      } else if (SCAN.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('never reads or writes the authToken key, only removes the legacy one', () => {
    const offenders = [];
    for (const file of listFiles(SRC)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/localStorage\.(getItem|setItem)\(\s*['"]authToken['"]/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('sends no Bearer header built from stored credentials in the dashboards', () => {
    const offenders = [];
    for (const file of listFiles(SRC)) {
      if (file.includes(`${path.sep}providers${path.sep}`) || file.includes(`${path.sep}common${path.sep}`)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (/Bearer \$\{authToken\}|'Bearer ' \+ authToken|Bearer \$\{token\}/.test(text)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
