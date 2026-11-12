/**
 * @fileoverview Unit tests for the filing service REST API.
 *
 * Mounts the local filing provider (in a temp directory under
 * .temp/tests/data) on a bare Express application and exercises upload,
 * streaming upload, download, browse, file tree, analytics, settings, PDF
 * preview and named-instance routes. The sync and git routes are exercised
 * against a stub provider, both with and without the optional capabilities.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const EventEmitter = require('events');

const createFiling = require('../../../src/filing');
const registerRoutes = require('../../../src/filing/routes');
const analytics = require('../../../src/filing/modules/analytics');
const { testDataDir } = require('../../helpers/testData');

describe('Filing routes (local provider)', () => {
  let app;
  let filing;
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(testDataDir('filing'), 'nooblyjs-filing-routes-'));
    app = express();
    app.use(express.json());
    app.use(express.text());
    const registry = {
      getServiceInstance: jest.fn(() => null),
      listInstances: jest.fn(() => [{ instanceName: 'archive', providerType: 'local' }])
    };
    filing = createFiling('local', { 'express-app': app, baseDir: dir, ServiceRegistry: registry }, new EventEmitter());
    analytics.clear?.();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    analytics.clear?.();
  });

  it('reports status and instances', async () => {
    await request(app).get('/services/filing/api/status').expect(200);
    const res = await request(app).get('/services/filing/api/instances').expect(200);
    expect(res.body.instances.map((i) => i.name)).toEqual(expect.arrayContaining(['default', 'archive']));
  });

  it('uploads raw text and multipart files, then downloads them', async () => {
    await request(app).post('/services/filing/api/upload/docs/a.txt').set('Content-Type', 'text/plain').send('hello').expect(200);
    await request(app)
      .post('/services/filing/api/upload/docs/b.png')
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'b.png')
      .expect(200);

    const text = await request(app).get('/services/filing/api/download/docs/a.txt?encoding=utf8').expect(200);
    expect(text.body).toEqual({ data: 'hello', encoding: 'utf8' });

    const inline = await request(app).get('/services/filing/api/download/docs/b.png').expect(200);
    expect(inline.headers['content-type']).toBe('image/png');
    expect(inline.headers['content-disposition']).toMatch(/^inline; filename="b\.png"/);
    expect(inline.headers['content-security-policy']).toMatch(/^sandbox/);

    const attachment = await request(app).get('/services/filing/api/download/docs/b.png?attachment=true').expect(200);
    expect(attachment.headers['content-disposition']).toBe('attachment; filename="b.png"; filename*=UTF-8\'\'b.png');

    await request(app).get('/services/filing/api/download/docs/missing.txt').expect(404);
  });

  it('rejects uploads without file data instead of crashing', async () => {
    // A JSON body used to reach Buffer.from(object) outside the try/catch,
    // an unhandled rejection that shuts the server down.
    await request(app).post('/services/filing/api/upload/docs/x.json').send({ a: 1 }).expect(400);
    await request(app).post('/services/filing/api/upload/docs/x.txt').expect(400);
    await request(app).post('/services/filing/api/archive/upload/docs/x.json').send({ a: 1 }).expect(400);
  });

  it('streams uploads', async () => {
    const res = await request(app)
      .post('/services/filing/api/upload-stream/docs/s.txt')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('streamed'))
      .expect(200);
    expect(res.body.key).toBe('docs/s.txt');
    expect(fs.readFileSync(path.join(dir, 'docs/s.txt'), 'utf8')).toBe('streamed');
  });

  it('browses folders and builds the file tree', async () => {
    await filing.upload('docs/a.txt', Buffer.from('a'));
    const root = await request(app).get('/services/filing/api/browse/').expect(200);
    expect(root.body.items).toEqual([expect.objectContaining({ name: 'docs', type: 'folder' })]);
    const docs = await request(app).get('/services/filing/api/browse/docs').expect(200);
    expect(docs.body.items.map((i) => i.name)).toEqual(['a.txt']);

    await request(app).get('/services/filing/api/download/docs/a.txt').expect(200);
    const tree = await request(app).get('/services/filing/api/file-tree').expect(200);
    expect(tree.body.totalPaths).toBeGreaterThan(0);
  });

  it('removes files', async () => {
    await filing.upload('docs/r.txt', Buffer.from('r'));
    await request(app).delete('/services/filing/api/remove/docs/r.txt').expect(200);
    expect(fs.existsSync(path.join(dir, 'docs/r.txt'))).toBe(false);
  });

  it('tracks and clears analytics', async () => {
    await filing.upload('docs/a.txt', Buffer.from('a'));
    await request(app).get('/services/filing/api/download/docs/a.txt').expect(200);
    const res = await request(app).get('/services/filing/api/analytics?limit=10').expect(200);
    expect(res.body.stats.totalReads).toBeGreaterThanOrEqual(1);
    const stats = await request(app).get('/services/filing/api/analytics/stats').expect(200);
    expect(stats.body.totalOperations).toBeGreaterThan(0);
    await request(app).delete('/services/filing/api/analytics').expect(200);
    const cleared = await request(app).get('/services/filing/api/analytics/stats').expect(200);
    expect(cleared.body.totalOperations).toBe(0);
  });

  it('gets and saves settings', async () => {
    const res = await request(app).get('/services/filing/api/settings').expect(200);
    expect(res.body.list).toEqual(expect.any(Array));
    await request(app).post('/services/filing/api/settings').send({}).expect(200);
    await request(app).get('/services/filing/api/archive/settings').expect(200);
    await request(app).post('/services/filing/api/archive/settings').send({}).expect(200);
  });

  it('only previews PDFs', async () => {
    await filing.upload('docs/a.txt', Buffer.from('a'));
    await request(app).get(`/services/filing/api/pdf-preview/${encodeURIComponent('docs/a.txt')}`).expect(400);
  });

  it('serves named-instance routes, falling back to the default instance', async () => {
    await request(app).post('/services/filing/api/archive/upload/docs/i.txt').set('Content-Type', 'text/plain').send('i').expect(200);
    await request(app).get('/services/filing/api/archive/download/docs/i.txt').expect(200);
    const browse = await request(app).get('/services/filing/api/archive/browse/docs').expect(200);
    expect(browse.body.items.map((i) => i.name)).toContain('i.txt');
    await request(app).get('/services/filing/api/archive/analytics').expect(200);
    await request(app).delete('/services/filing/api/archive/remove/docs/i.txt').expect(200);
  });

  it('hides provider failures', async () => {
    jest.spyOn(filing, 'upload').mockRejectedValue(new Error('disk /secret/path'));
    const res = await request(app).post('/services/filing/api/upload/docs/a.txt').set('Content-Type', 'text/plain').send('x').expect(500);
    expect(JSON.stringify(res.body)).not.toContain('/secret/path');
  });
});

describe('Filing routes (sync and git)', () => {
  /** Builds a stub provider supporting every sync/git capability. */
  function makeSyncProvider() {
    return {
      providerType: 'sync',
      upload: jest.fn(), download: jest.fn(), remove: jest.fn(), list: jest.fn(async () => []),
      getSettings: jest.fn(async () => ({})), saveSettings: jest.fn(),
      syncFile: jest.fn(async (p) => { if (p === 'bad') throw new Error('x'); }),
      lockFile: jest.fn(async () => {}),
      unlockFile: jest.fn(async () => {}),
      getSyncStatus: jest.fn(async () => ({ modified: ['p1'], locked: [] })),
      pushFile: jest.fn(async () => {}),
      pullFile: jest.fn(async (p) => { if (p === 'bad') throw new Error('x'); }),
      syncAll: jest.fn(async () => {}),
      processRemoteChanges: jest.fn(async () => {}),
      startAutoSync: jest.fn(), stopAutoSync: jest.fn(),
      commitWithMessage: jest.fn(async () => ({ sha: 'abc' })),
      push: jest.fn(async () => ({ pushed: 1 })),
      fetch: jest.fn(async () => {}),
      getGitStatus: jest.fn(async () => ({ clean: true })),
      getPendingCommits: jest.fn(() => [{ id: 'c1' }]),
      cancelCommit: jest.fn(async () => {}),
      startAutoFetch: jest.fn(), stopAutoFetch: jest.fn()
    };
  }

  let app;
  let provider;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    provider = makeSyncProvider();
    registerRoutes({ 'express-app': app, providerType: 'sync' }, new EventEmitter(), provider);
  });

  it('runs sync operations', async () => {
    const synced = await request(app).post('/services/filing/api/sync/files').send({ files: ['a', 'bad'] }).expect(200);
    expect(JSON.stringify(synced.body)).toContain('bad');
    await request(app).post('/services/filing/api/sync/files').send({}).expect(400);

    await request(app).post('/services/filing/api/sync/lock/a.txt').send({ reason: 'edit' }).expect(200);
    expect(provider.lockFile).toHaveBeenCalledWith('a.txt', 'edit');
    await request(app).post('/services/filing/api/sync/unlock/a.txt').expect(200);
    await request(app).get('/services/filing/api/sync/status').expect(200);

    await request(app).post('/services/filing/api/sync/push').send({ files: ['x'] }).expect(200);
    await request(app).post('/services/filing/api/sync/push').send({}).expect(200);
    expect(provider.pushFile).toHaveBeenCalledWith('p1');

    await request(app).post('/services/filing/api/sync/pull').send({ files: ['x', 'bad'] }).expect(200);
    await request(app).post('/services/filing/api/sync/pull').send({}).expect(200);
    expect(provider.syncAll).toHaveBeenCalled();

    await request(app).post('/services/filing/api/sync/notify-change').send({ files: ['x'] }).expect(200);
    await request(app).post('/services/filing/api/sync/notify-change').send({}).expect(400);
    await request(app).post('/services/filing/api/sync/auto/start').expect(200);
    await request(app).post('/services/filing/api/sync/auto/stop').expect(200);
  });

  it('runs git operations', async () => {
    await request(app).post('/services/filing/api/git/commit').send({ commitId: 'c1', message: 'm' }).expect(200);
    await request(app).post('/services/filing/api/git/commit').send({ commitId: 'c1' }).expect(400);
    await request(app).post('/services/filing/api/git/push').expect(200);
    await request(app).post('/services/filing/api/git/fetch').expect(200);
    await request(app).get('/services/filing/api/git/status').expect(200);
    const pending = await request(app).get('/services/filing/api/git/pending?userId=u1').expect(200);
    expect(JSON.stringify(pending.body)).toContain('c1');
    await request(app).delete('/services/filing/api/git/pending/c1').send({ userId: 'u1' }).expect(200);
    expect(provider.cancelCommit).toHaveBeenCalledWith('c1', 'u1');
    await request(app).post('/services/filing/api/git/auto-fetch/start').expect(200);
    await request(app).post('/services/filing/api/git/auto-fetch/stop').expect(200);
  });

  it('hides failures from sync and git operations', async () => {
    provider.lockFile.mockRejectedValue(new Error('internal'));
    provider.push.mockRejectedValue(new Error('internal'));
    provider.getGitStatus.mockRejectedValue(new Error('internal'));
    const res = await request(app).post('/services/filing/api/sync/lock/a').expect(500);
    expect(JSON.stringify(res.body)).not.toContain('internal');
    await request(app).post('/services/filing/api/git/push').expect(500);
    await request(app).get('/services/filing/api/git/status').expect(500);
  });

  it('returns 400 when the provider lacks sync and git support', async () => {
    const bare = express();
    bare.use(express.json());
    registerRoutes({ 'express-app': bare }, new EventEmitter(), { upload: jest.fn(), providerType: 'local' });
    const unsupported = [
      ['post', '/services/filing/api/sync/files'],
      ['post', '/services/filing/api/sync/lock/a'],
      ['post', '/services/filing/api/sync/unlock/a'],
      ['get', '/services/filing/api/sync/status'],
      ['post', '/services/filing/api/sync/push'],
      ['post', '/services/filing/api/sync/pull'],
      ['post', '/services/filing/api/sync/notify-change'],
      ['post', '/services/filing/api/sync/auto/start'],
      ['post', '/services/filing/api/sync/auto/stop'],
      ['post', '/services/filing/api/git/commit'],
      ['post', '/services/filing/api/git/push'],
      ['post', '/services/filing/api/git/fetch'],
      ['get', '/services/filing/api/git/status'],
      ['get', '/services/filing/api/git/pending'],
      ['delete', '/services/filing/api/git/pending/c1'],
      ['post', '/services/filing/api/git/auto-fetch/start'],
      ['post', '/services/filing/api/git/auto-fetch/stop']
    ];
    for (const [method, url] of unsupported) {
      const res = await request(bare)[method](url).send({});
      expect({ url, status: res.status }).toEqual({ url, status: 400 });
    }
  });
});
