/**
 * @fileoverview Tests for filing upload limits (P2-2): size (413), type (415)
 * and streaming uploads, through the real filing routes.
 *
 * @author NooblyJS Team
 * @since 1.1.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('events');
const express = require('express');
const request = require('supertest');
const createFiling = require('../../../src/filing');
const { resolveUploadLimits, isTypeAllowed } = require('../../../src/filing/modules/uploadLimits');
const { testDataDir } = require('../../helpers/testData');

/** Test run data lives under .temp/tests/data (see .claude/rules/output-locations.md). */
const TEST_FILES_DIR = testDataDir();

/** Stands in for an authenticated admin session; the filing tiers need a caller. */
function asAdmin(req, _res, next) {
  req.user = { email: 'admin@test.local', roles: ['admin'] };
  next();
}

/**
 * Builds an app with a local filing service rooted in a temp directory.
 *
 * @param {Object} providerOptions - Extra filing options
 * @return {{app: express.Application, baseDir: string}} App and its storage dir
 */
function buildApp(providerOptions = {}) {
  const baseDir = fs.mkdtempSync(path.join(TEST_FILES_DIR, 'nooblyjs-upload-'));
  const app = express();
  app.use(asAdmin);
  createFiling('local', { 'express-app': app, baseDir, ...providerOptions }, new EventEmitter());
  return { app, baseDir };
}

describe('Filing upload limits (P2-2)', () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('accepts an upload within maxFileSize', async () => {
    const { app, baseDir } = buildApp({ maxFileSize: 1024 });
    dirs.push(baseDir);
    const res = await request(app)
      .post('/services/filing/api/upload/small.txt')
      .attach('file', Buffer.alloc(512, 97), 'small.txt');
    expect(res.status).toBe(200);
    expect(fs.statSync(path.join(baseDir, 'small.txt')).size).toBe(512);
  });

  it('rejects a multipart upload over maxFileSize with 413 and stores nothing', async () => {
    const { app, baseDir } = buildApp({ maxFileSize: 1024 });
    dirs.push(baseDir);
    const res = await request(app)
      .post('/services/filing/api/upload/big.txt')
      .attach('file', Buffer.alloc(4096, 97), 'big.txt');
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/maximum upload size/);
    expect(fs.existsSync(path.join(baseDir, 'big.txt'))).toBe(false);
  });

  it('rejects early from Content-Length before buffering', async () => {
    const { app, baseDir } = buildApp({ maxFileSize: 1024 });
    dirs.push(baseDir);
    const res = await request(app)
      .post('/services/filing/api/upload/huge.bin')
      .attach('file', Buffer.alloc(200 * 1024, 97), 'huge.bin');
    expect(res.status).toBe(413);
  });

  it('rejects a disallowed file type with 415', async () => {
    const { app, baseDir } = buildApp({ allowedTypes: '.md,.txt,image/*' });
    dirs.push(baseDir);
    const res = await request(app)
      .post('/services/filing/api/upload/script.exe')
      .attach('file', Buffer.from('MZ'), 'script.exe');
    expect(res.status).toBe(415);
  });

  it('rejects a streamed upload over maxFileSize with 413', async () => {
    const { app, baseDir } = buildApp({ maxFileSize: 1024 });
    dirs.push(baseDir);
    const res = await request(app)
      .post('/services/filing/api/upload-stream/stream.bin')
      .set('content-type', 'application/octet-stream')
      .send(Buffer.alloc(8192, 97));
    expect(res.status).toBe(413);
  });

  it('applies limits to named instances too', async () => {
    const { app, baseDir } = buildApp({ maxFileSize: 1024 });
    dirs.push(baseDir);
    const res = await request(app)
      .post('/services/filing/api/default/upload/big.txt')
      .attach('file', Buffer.alloc(4096, 97), 'big.txt');
    expect(res.status).toBe(413);
  });

  describe('helpers', () => {
    it('resolveUploadLimits reads provider settings and treats * as allow-all', () => {
      const limits = resolveUploadLimits({ provider: { settings: { maxFileSize: 2048, allowedTypes: '*' } } });
      expect(limits).toEqual({ maxFileSize: 2048, allowedTypes: [] });
    });

    it('isTypeAllowed matches extensions, MIME types and wildcards', () => {
      const allowed = ['.pdf', 'text/plain', 'image/*', 'md'];
      expect(isTypeAllowed(allowed, 'a.pdf')).toBe(true);
      expect(isTypeAllowed(allowed, 'a.bin', 'text/plain')).toBe(true);
      expect(isTypeAllowed(allowed, 'a.bin', 'image/png')).toBe(true);
      expect(isTypeAllowed(allowed, 'notes.md')).toBe(true);
      expect(isTypeAllowed(allowed, 'a.exe', 'application/x-msdownload')).toBe(false);
      expect(isTypeAllowed([], 'anything.exe')).toBe(true);
    });
  });
});
