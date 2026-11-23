/**
 * @fileoverview Google sign-in's callback: the redirect URI sent to Google and the route core answers are the same
 * path (the default, or the path of options.callbackURL), and the route sends the browser on (or back to the login
 * page) rather than answering with JSON. Google is not contacted: passport.authenticate is stubbed.
 */

'use strict';

process.env.BCRYPT_COST = process.env.BCRYPT_COST || '4';

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const EventEmitter = require('events');
const passport = require('passport');

const createAuth = require('../../../src/authservice');
const AuthGoogle = require('../../../src/authservice/providers/authGoogle');

const DEFAULT = '/services/authservice/api/google/callback';

/** passport.authenticate for the callback: signs Ada in, or fails. */
function stubGoogle(outcome) {
  return jest.spyOn(passport, 'authenticate').mockImplementation((strategy, optsOrCb) => (req, res, next) => {
    // passport.session() is built from authenticate('session'): leave it be.
    if (strategy !== 'google') return next();
    if (typeof optsOrCb !== 'function') return res.redirect('https://accounts.google.com/o/oauth2/v2/auth');
    if (outcome === 'fail') return optsOrCb(null, null, {});
    return optsOrCb(null, { email: 'ada@x.com', fullName: 'Ada' }, { session: { token: 't' } });
  });
}

function appWith(options = {}) {
  const app = express();
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { req.logIn = (user, cb) => cb(null); next(); });
  const auth = createAuth('google', { 'express-app': app, clientID: 'id', clientSecret: 'secret', ...options }, new EventEmitter());
  return { app, auth };
}

describe('Google sign-in callback', () => {
  const env = { ...process.env };
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...env };
  });

  it('defaults to the path core answers, with the base URL when one is known', () => {
    expect(AuthGoogle.GOOGLE_CALLBACK_PATH).toBe(DEFAULT);
    expect(new AuthGoogle({}).callbackURL_).toBe(DEFAULT);
    expect(new AuthGoogle({ baseUrl: 'https://cloud.example/' }).callbackURL_).toBe(`https://cloud.example${DEFAULT}`);
    process.env.GOOGLE_BASE_URL = 'https://env.example';
    expect(new AuthGoogle({}).callbackURL_).toBe(`https://env.example${DEFAULT}`);
    const own = new AuthGoogle({ callbackURL: 'https://cloud.example/oauth/google?x=1' });
    expect([own.callbackURL_, own.callbackPath_]).toEqual(['https://cloud.example/oauth/google?x=1', '/oauth/google']);
  });

  it('answers the default path and sends the browser on to where it was going', async () => {
    stubGoogle('ok');
    const { app } = appWith({ loginSuccessRedirectUrl: '/' });
    const res = await request(app).get(`${DEFAULT}?code=c&state=s`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('answers the path of a callbackURL it was given, and not the default', async () => {
    stubGoogle('ok');
    const { app } = appWith({ callbackURL: 'https://cloud.example/oauth/google', loginSuccessRedirectUrl: '/home' });
    const res = await request(app).get('/oauth/google?code=c');
    expect([res.status, res.headers.location]).toEqual([302, '/home']);
    expect((await request(app).get(`${DEFAULT}?code=c`)).status).toBe(404);
  });

  it('a failed sign-in goes back to the login page with an error, not JSON', async () => {
    stubGoogle('fail');
    const { app } = appWith();
    const res = await request(app).get(`${DEFAULT}?error=access_denied`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/services/authservice/views/login.html?error=Google%20sign-in%20failed');
  });
});
