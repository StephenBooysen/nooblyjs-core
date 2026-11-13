/**
 * @fileoverview Regression tests for stored-XSS through filing (review
 * 2026-11-12, finding H-1; feature 17a).
 *
 * The reproduced chain uploaded an HTML file, then opened it inline from the
 * portal origin, where its script ran with an admin's session. These tests
 * assert that active content is never served inline, that inline types carry a
 * sandbox policy, that the default upload list refuses HTML, and that filenames
 * cannot break the Content-Disposition header.
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

const createFiling = require('../../../src/filing');
const { contentDisposition, deliveryPolicy, SANDBOX_CSP } = require('../../../src/filing/modules/contentDelivery');
const { testDataDir } = require('../../helpers/testData');

const PAYLOAD = '<html><script>document.cookie</script></html>';
const SVG_PAYLOAD = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>';

describe('Security regression: safe content serving (H-1)', () => {
  let root;
  let app;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(testDataDir('security-serving'), 'store-'));
    // The default configuration: no type override, so the safe list applies.
    app = express();
    app.use((req, _res, next) => {
      req.user = { email: 'editor@test.local', roles: ['editor'] };
      next();
    });
    createFiling('local', { 'express-app': app, baseDir: root }, new EventEmitter());
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses HTML and SVG uploads under the default allow-list', async () => {
    await request(app)
      .post('/services/filing/api/upload/evil.html')
      .set('Content-Type', 'text/html')
      .send(PAYLOAD)
      .expect(415);
    await request(app)
      .post('/services/filing/api/upload/evil.svg')
      .set('Content-Type', 'image/svg+xml')
      .send(SVG_PAYLOAD)
      .expect(415);
  });

  it('always downloads active content, even when inline viewing is requested', async () => {
    // Stored before the policy existed, or uploaded under a permissive allow-list.
    fs.writeFileSync(path.join(root, 'evil.html'), PAYLOAD);
    fs.writeFileSync(path.join(root, 'evil.svg'), SVG_PAYLOAD);

    for (const name of ['evil.html', 'evil.svg']) {
      const inline = await request(app).get(`/services/filing/api/download/${name}`).expect(200);
      expect(inline.headers['content-type']).toBe('application/octet-stream');
      expect(inline.headers['content-disposition']).toMatch(/^attachment;/);
      expect(inline.headers['content-security-policy']).toBeUndefined();

      const forced = await request(app).get(`/services/filing/api/download/${name}?attachment=false`).expect(200);
      expect(forced.headers['content-type']).toBe('application/octet-stream');
      expect(forced.headers['content-disposition']).toMatch(/^attachment;/);
    }
  });

  it('treats unknown types as downloads too', async () => {
    fs.writeFileSync(path.join(root, 'mystery.zzz'), 'bytes');
    const res = await request(app).get('/services/filing/api/download/mystery.zzz').expect(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('serves inline images and PDFs under a sandbox policy with nosniff', async () => {
    fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await request(app).get('/services/filing/api/download/logo.png').expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['content-security-policy']).toBe(SANDBOX_CSP);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps attachments of safe types as downloads with their real type', async () => {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'plain');
    const res = await request(app).get('/services/filing/api/download/notes.txt?attachment=true').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('encodes filenames so quotes and line breaks cannot break the header', () => {
    const header = contentDisposition('attachment', 'a"b\r\nSet-Cookie: x=1.txt');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toMatch(/^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''/);
    expect(header).toContain(encodeURIComponent('a"b\r\nSet-Cookie: x=1.txt').replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()));
  });

  it('classifies delivery by extension, not by the caller', () => {
    expect(deliveryPolicy('a.html', false, 'text/html').disposition).toBe('attachment');
    expect(deliveryPolicy('a.PNG', false, 'image/png')).toEqual({
      disposition: 'inline', contentType: 'image/png', sandbox: true
    });
    expect(deliveryPolicy('a.svg', true, 'image/svg+xml').contentType).toBe('application/octet-stream');
  });
});
