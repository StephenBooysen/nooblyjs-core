'use strict';

/**
 * @fileoverview Session and token hygiene (feature 23, review finding M-2).
 *
 * No tokens in URLs or page script, CSRF origin check, idle and absolute
 * timeouts, revocation on password and role change, expiring personal access
 * tokens with admin revocation, the one-time cookie hand-off, and the
 * Referrer-Policy header.
 */

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const request = require('supertest');
const { EventEmitter } = require('events');

const serviceRegistry = require('../../../index');
const {
  createCookieSessionHygiene,
  createOriginCheck
} = require('../../../src/authservice/middleware/sessionHygiene');

const KEY = 'hygiene-key-0123456789abcdef0123456789ab';
const PASSWORD = 'Str0ng!Pass#2026';
const SRC = path.join(__dirname, '../../../src');

/** Every dashboard page and browser script under src/. */
function dashboardFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'common') continue;
        walk(full);
      } else if (/\.html$/.test(entry.name) || (/[/\\](views|scripts)[/\\]/.test(full) && /\.js$/.test(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

describe('no session tokens in URLs or page script', () => {
  it('no dashboard builds an authToken URL or reads a script-held session token', () => {
    const offenders = dashboardFiles().filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return /authToken=/.test(text) || /localStorage\.(getItem|setItem)\(\s*['"]authToken['"]/.test(text);
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

describe('origin check', () => {
  const app = express();
  app.use(createOriginCheck({ allowedOrigins: ['https://admin.example.com'] }));
  app.all('*', (req, res) => res.json({ ok: true }));

  it('refuses a cross-site state-changing cookie request', async () => {
    const res = await request(app).post('/x').set('Host', 'app.example.com').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_ORIGIN_MISMATCH');
    await request(app).post('/x').set('Host', 'app.example.com').set('Referer', 'https://evil.example/page').expect(403);
    await request(app).post('/x').set('Host', 'app.example.com').set('Origin', 'null').expect(403);
  });

  it('allows same-origin, trusted origins, safe methods, header credentials and non-browser clients', async () => {
    await request(app).post('/x').set('Host', 'app.example.com').set('Origin', 'https://app.example.com').expect(200);
    await request(app).post('/x').set('Host', 'app.example.com').set('Origin', 'https://admin.example.com').expect(200);
    await request(app).get('/x').set('Origin', 'https://evil.example').expect(200);
    await request(app).post('/x').set('Origin', 'https://evil.example').set('x-api-key', 'k').expect(200);
    await request(app).post('/x').set('Origin', 'https://evil.example').set('Authorization', 'Bearer t').expect(200);
    await request(app).post('/x').expect(200);
  });
});

describe('cookie session hygiene', () => {
  const auth = {
    sessionConfig_: () => ({ absoluteTimeoutMs: 24 * 3600e3 }),
    idleTimeoutFor: (roles) => (roles.includes('admin') ? 30 * 60e3 : 8 * 3600e3),
    logout: jest.fn().mockResolvedValue()
  };
  const run = (user, sess) => {
    const req = { session: sess, user, isAuthenticated: () => Boolean(req.user) };
    createCookieSessionHygiene({ getAuth: () => auth })(req, {}, () => {});
    return req;
  };

  it('expires an idle admin session after 30 minutes but not a user session', () => {
    const now = Date.now();
    const admin = run({ email: 'a', roles: ['admin'] }, { loginAt: now - 3600e3, lastSeenAt: now - 31 * 60e3, authToken: 't' });
    expect(admin.user).toBeNull();
    expect(admin.session.passport).toBeUndefined();
    expect(auth.logout).toHaveBeenCalledWith('t');
    const user = run({ email: 'u', roles: ['user'] }, { loginAt: now - 3600e3, lastSeenAt: now - 31 * 60e3 });
    expect(user.user).not.toBeNull();
  });

  it('applies the absolute lifetime and revocation', () => {
    const now = Date.now();
    expect(run({ email: 'u', roles: ['user'] }, { loginAt: now - 25 * 3600e3, lastSeenAt: now }).user).toBeNull();
    expect(run({ email: 'u', roles: ['user'], sessionsValidAfter: now - 1000 }, { loginAt: now - 5000, lastSeenAt: now }).user).toBeNull();
    const fresh = run({ email: 'u', roles: ['user'], sessionsValidAfter: now - 9000 }, { loginAt: now - 5000, lastSeenAt: now - 10 });
    expect(fresh.user).not.toBeNull();
    expect(fresh.session.lastSeenAt).toBeGreaterThanOrEqual(now);
  });
});

describe('with the registry', () => {
  let app;
  let auth;
  let workDir;

  const login = async (agent, email, password = PASSWORD) => (await agent
    .post('/services/authservice/api/login')
    .send({ email, password })
    .expect(200)).body.data.session.token;

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(require('../../helpers/testData').testDataDir(), 'hygiene-'));
    serviceRegistry.reset();
    app = express();
    app.use(express.json());
    app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
    app.use(passport.initialize());
    app.use(passport.session());
    serviceRegistry.initialize(app, new EventEmitter(), {
      security: { apiKeyAuth: { apiKeys: [KEY], requireApiKey: true } }
    });
    serviceRegistry.cache('memory');
    auth = serviceRegistry.authservice('memory');
    const strategy = auth.getAuthStrategy();
    passport.serializeUser(strategy.serializeUser);
    passport.deserializeUser(strategy.deserializeUser);
    await auth.createUser({ email: 'admin@hy.test', fullName: 'Admin', password: PASSWORD, role: 'admin' });
    await auth.createUser({ email: 'user@hy.test', fullName: 'User', password: PASSWORD, role: 'user' });
  }, 30000);

  afterAll(() => {
    serviceRegistry.reset();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('refuses a session token in the query string', async () => {
    const token = await login(request(app), 'admin@hy.test');
    await request(app).get('/services/caching/api/settings').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app)
      .get(`/services/caching/api/settings?authToken=${token}`)
      .set('Accept', 'application/json')
      .expect(401);
  });

  it('dashboards work on the cookie alone after login', async () => {
    const agent = request.agent(app);
    await login(agent, 'admin@hy.test');
    await agent.get('/services/caching/api/settings').expect(200);
    const who = await agent.get('/services/authservice/api/session').expect(200);
    expect(who.body).toMatchObject({ authenticated: true, user: { email: 'admin@hy.test' } });
  });

  it('a role change ends the user\'s sessions, token and cookie alike', async () => {
    const agent = request.agent(app);
    const token = await login(agent, 'user@hy.test');
    await agent.get('/services/authservice/api/session').expect(200).then((r) => expect(r.body.authenticated).toBe(true));
    await new Promise((r) => setTimeout(r, 5));
    await auth.addUserToRole('user@hy.test', 'editor');
    await expect(auth.validateSession(token)).rejects.toThrow();
    const who = await agent.get('/services/authservice/api/session').expect(200);
    expect(who.body.authenticated).toBe(false);
  });

  it('a password change invalidates existing sessions', async () => {
    const token = (await auth.authenticateUser('user@hy.test', PASSWORD)).session.token;
    await auth.changePassword('user@hy.test', PASSWORD, 'N3w!Password#2026');
    await expect(auth.validateSession(token)).rejects.toThrow();
    await auth.authenticateUser('user@hy.test', 'N3w!Password#2026');
  });

  it('an idle admin token session expires after 30 minutes', async () => {
    const token = (await auth.authenticateUser('admin@hy.test', PASSWORD)).session.token;
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 29 * 60e3;
      await expect(auth.validateSession(token)).resolves.toBeTruthy();
      Date.now = () => realNow() + 60 * 60e3;
      await expect(auth.validateSession(token)).rejects.toThrow('Session expired');
    } finally {
      Date.now = realNow;
    }
  });

  it('hands a session token over for the cookie once, by POST only', async () => {
    const token = await login(request(app), 'admin@hy.test');
    const agent = request.agent(app);
    const res = await agent.post('/services/authservice/api/session/handoff')
      .send({ token, returnUrl: '/services/caching' })
      .expect(200);
    expect(res.body.redirectUrl).toBe('/services/caching');
    await agent.get('/services/caching/api/settings').expect(200);
    await request(app).post('/services/authservice/api/session/handoff').send({ token: 'nope' }).expect(401);
  });

  it('personal access tokens expire by default and admins can list and revoke them', async () => {
    const adminToken = await login(request(app), 'admin@hy.test');
    const created = await auth.createApiToken('admin@hy.test', 'ci');
    const days = (new Date(created.expiresAt) - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(90);

    const list = await request(app).get('/services/authservice/api/users/admin@hy.test/tokens')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(list.body.data[0]).toEqual(expect.objectContaining({ id: created.id, lastUsed: null }));
    expect(list.body.data[0].token).toBeUndefined();

    await request(app).delete(`/services/authservice/api/users/admin@hy.test/tokens/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    await expect(auth.validateApiToken(created.token)).rejects.toThrow();
  });

  it('a user cannot revoke someone else\'s tokens', async () => {
    // Straight from the provider: the login route's rate limiter has had enough.
    const userToken = (await auth.authenticateUser('user@hy.test', 'N3w!Password#2026')).session.token;
    const res = await request(app).get('/services/authservice/api/users/admin@hy.test/tokens')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('dashboards send no Referer', async () => {
    const res = await request(app).get('/services/caching/api/status');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });
});
