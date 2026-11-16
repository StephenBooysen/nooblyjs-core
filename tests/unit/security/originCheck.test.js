'use strict';

/**
 * @fileoverview CSRF origin check for `/services` (feature 23).
 */

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const { createOriginCheck, originOf } = require('../../../src/authservice/middleware/originCheck');

describe('originOf', () => {
  it('returns the origin of a URL and null for anything else', () => {
    expect(originOf('https://app.example.com/some/page?x=1')).toBe('https://app.example.com');
    expect(originOf('not a url')).toBeNull();
    expect(originOf('')).toBeNull();
  });
});

describe('createOriginCheck', () => {
  let app;
  let events;

  beforeEach(() => {
    events = new EventEmitter();
    app = express();
    app.use(createOriginCheck({ allowedOrigins: ['https://admin.example.com'], eventEmitter: events }));
    app.use((req, res) => res.json({ ok: true }));
  });

  it('refuses a cross-site state-changing request that carries the cookie', async () => {
    const rejected = jest.fn();
    events.on('auth:csrf-origin-rejected', rejected);

    const res = await request(app).post('/x').set('Host', 'app.example.com').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_ORIGIN_MISMATCH');
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ origin: 'https://evil.example', method: 'POST' }));

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
