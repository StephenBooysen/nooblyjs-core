/**
 * @fileoverview Regression tests for arbitrary script execution (review
 * 2026-11-12, finding H-3; feature 18).
 *
 * The working, scheduling and workflow services run JavaScript files in worker
 * threads. Before the fix, a caller could name any file on disk. These tests
 * drive the real working routes and assert that paths outside the activities
 * folder, the wrong file types, and symlinks that escape the folder are refused.
 * No worker thread is spawned: accepted runs are only queued.
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

const registerRoutes = require('../../../src/working/routes');
const WorkerManager = require('../../../src/working/providers/working');
const WorkingAnalytics = require('../../../src/working/modules/analytics');
const { testDataDir } = require('../../helpers/testData');

/** In-memory queue that round-trips items as JSON, like a real broker. */
class BrokerQueue {
  constructor() {
    this.queues = new Map();
  }
  list_(name) {
    if (!this.queues.has(name)) this.queues.set(name, []);
    return this.queues.get(name);
  }
  async enqueue(name, item) {
    this.list_(name).push(JSON.stringify(item));
  }
  async dequeue(name) {
    const raw = this.list_(name).shift();
    return raw === undefined ? undefined : JSON.parse(raw);
  }
  async size(name) {
    return this.list_(name).length;
  }
}

/**
 * Builds a manager and a Express app with the working routes mounted. The
 * queue processor is stopped, so nothing runs.
 *
 * @param {Object} options - Extra working options
 * @return {{app: express.Application, manager: WorkerManager, root: string, outside: string}}
 */
function build(options = {}) {
  const base = testDataDir('security-activities');
  const sandbox = fs.mkdtempSync(path.join(base, 'case-'));
  const root = path.join(sandbox, 'activities');
  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'resize.js'), 'module.exports = () => {};');
  fs.writeFileSync(path.join(outside, 'evil.js'), 'module.exports = () => {};');

  const eventEmitter = new EventEmitter();
  const manager = new WorkerManager(
    {
      dependencies: { queueing: new BrokerQueue() },
      enableLogging: false,
      activitiesFolder: root,
      ...options
    },
    eventEmitter
  );
  manager.stopQueueProcessor_();

  const app = express();
  app.use(express.json());
  registerRoutes({ 'express-app': app }, eventEmitter, manager, new WorkingAnalytics(eventEmitter));
  return { app, manager, root, outside, sandbox };
}

describe('Security regression: code execution boundary (H-3)', () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      await fn();
    }
  });

  /** Registers a build for cleanup and returns it. */
  function make(options) {
    const built = build(options);
    cleanups.push(async () => {
      built.manager.isRunning_ = false;
      fs.rmSync(built.sandbox, { recursive: true, force: true });
    });
    return built;
  }

  it('refuses absolute script paths such as /etc/passwd', async () => {
    const { app } = make();
    const res = await request(app).post('/services/working/api/run').send({ scriptPath: '/etc/passwd' }).expect(400);
    expect(res.body.error).toMatch(/Absolute script paths are not allowed/);
  });

  it('refuses traversal out of the activities folder', async () => {
    const { app } = make();
    await request(app).post('/services/working/api/run').send({ scriptPath: '../../index.js' }).expect(400);
    await request(app).post('/services/working/api/run').send({ scriptPath: '../outside/evil.js' }).expect(400);
  });

  it('refuses files that are not .js, .mjs or .cjs', async () => {
    const { app, root } = make();
    fs.writeFileSync(path.join(root, 'tool.sh'), 'echo hi');
    await request(app).post('/services/working/api/run').send({ scriptPath: 'tool.sh' }).expect(400);
  });

  it('refuses a symlink inside the folder that points outside it', async () => {
    const { app, root, outside } = make();
    fs.symlinkSync(path.join(outside, 'evil.js'), path.join(root, 'link.js'));
    const res = await request(app).post('/services/working/api/run').send({ scriptPath: 'link.js' }).expect(400);
    expect(res.body.error).toMatch(/outside the activities folder/);
  });

  it('accepts a script inside the folder', async () => {
    const { app } = make();
    await request(app).post('/services/working/api/run').send({ scriptPath: 'resize.js' }).expect(201);
  });

  it('allows absolute paths only through the explicit opt-in', async () => {
    const { app, outside } = make({ allowAbsolutePaths: true });
    await request(app)
      .post('/services/working/api/run')
      .send({ scriptPath: path.join(outside, 'evil.js') })
      .expect(201);
  });

  it('runs only registered names over HTTP once an activity registry is configured', async () => {
    // Registry paths come from operator config and are trusted, so they are not
    // checked against the activities folder. The queue is never drained here.
    const registered = path.join(testDataDir('security-activities'), 'registry', 'resize.js');
    const { app } = make({ activities: { 'resize-image': registered } });

    // Raw paths are refused outright, even one that would otherwise be fine.
    const raw = await request(app).post('/services/working/api/run').send({ scriptPath: 'resize.js' }).expect(400);
    expect(raw.body.error).toMatch(/Raw script paths are disabled/);

    // A registered name queues; an unknown name is not found.
    await request(app).post('/services/working/api/run').send({ activity: 'resize-image', data: {} }).expect(201);
    await request(app).post('/services/working/api/run').send({ activity: 'delete-everything' }).expect(404);
  });

  it('rejects activity names and paths that do not fit the registry rules', () => {
    expect(() => build({ activities: { '../escape': 'x.js' } })).toThrow(/Invalid activity name/);
    expect(() => build({ activities: { ok: 'x.sh' } })).toThrow(/must point at a \.js, \.mjs or \.cjs file/);
  });

  it('refuses to start when the activities folder sits inside a filing root', () => {
    const base = testDataDir('security-activities');
    const filingRoot = fs.mkdtempSync(path.join(base, 'filing-'));
    cleanups.push(async () => fs.rmSync(filingRoot, { recursive: true, force: true }));
    const nested = path.join(filingRoot, 'activities');
    expect(() => new WorkerManager(
      {
        activitiesFolder: nested,
        dependencies: {
          queueing: new BrokerQueue(),
          filing: { provider: { rootDir_: filingRoot } }
        }
      },
      new EventEmitter()
    )).toThrow(/must not overlap a filing root/);
  });

  it('applies the same rule to scheduled and workflow steps', () => {
    const { manager } = make();
    expect(() => manager.validateActivityPath('/etc/passwd')).toThrow(/Absolute script paths are not allowed/);
    expect(() => manager.validateActivityPath('../../index.js')).not.toThrow(); // syntax only; resolved at run time
    expect(() => manager.validateActivityPath('index.exe')).toThrow(/must be \.js/);
  });
});
