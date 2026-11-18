/**
 * @fileoverview Unit tests for the schedule manager: pause / resume, in-place
 * updates, next-run planning, per-task outcome bookkeeping and run history in
 * the scheduler provider, plus the manager REST routes behind the UI tab.
 *
 * @author NooblyJS Core Team
 * @since 1.1.0
 */

'use strict';

const express = require('express');
const request = require('supertest');
const SchedulerProvider = require('../../../src/scheduling/providers/scheduling');
const registerManagerRoutes = require('../../../src/scheduling/routes/manager');
const { nextMatch } = require('../../../src/scheduling/providers/cronExpression');

/** Builds a Date at a local wall-clock minute. */
const at = (day, hour, minute) => new Date(2026, 6, day, hour, minute, 0, 0);

/** Waits for pending callbacks. */
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('Schedule manager', () => {
  /** @type {Array<string>} */
  let fired;
  /** @type {SchedulerProvider} */
  let scheduler;

  beforeEach(() => {
    fired = [];
    const worker = {
      // Scripts named "fail*" error; "hang*" never answer; others succeed.
      start: (scriptPath, data, callback) => {
        fired.push(scriptPath);
        if (scriptPath.startsWith('hang')) return;
        setImmediate(() => {
          if (scriptPath.startsWith('fail')) callback('error', 'Upstream said no');
          else callback('completed', { ok: true, data });
        });
      }
    };
    scheduler = new SchedulerProvider({ retryAttempts: 1 }, null, worker);
  });

  afterEach(async () => {
    await scheduler.shutdown();
  });

  describe('provider', () => {
    it('plans the next run for cron and interval tasks', async () => {
      await scheduler.startCron({ scriptPath: 'a.js' }, '0 2 * * *', 'nightly');
      await scheduler.start('every-min', 'a.js', null, 60, undefined, { runImmediately: false });

      const nightly = await scheduler.getSchedule('nightly');
      const next = new Date(nightly.nextRun);
      expect(next.getHours()).toBe(2);
      expect(next.getTime()).toBeGreaterThan(Date.now());

      const interval = await scheduler.getSchedule('every-min');
      const inMs = Date.parse(interval.nextRun) - Date.now();
      expect(inMs).toBeGreaterThan(55000);
      expect(inMs).toBeLessThanOrEqual(60000);
      expect(fired).toHaveLength(0); // runImmediately: false
    });

    it('records each run and the task\'s own outcome, retries included', async () => {
      await scheduler.startCron({ scriptPath: 'fail.js' }, '0 1 * * *', 'flaky');
      scheduler.evaluateCronTasks_(at(8, 1, 0));
      for (let i = 0; i < 5; i++) await flush();

      const task = await scheduler.getSchedule('flaky');
      expect(task).toMatchObject({ lastResult: 'failed', lastError: 'Upstream said no', executionCount: 1, running: false });

      const { runs, total } = await scheduler.listRuns({ taskName: 'flaky' });
      expect(total).toBe(1);
      expect(runs[0]).toMatchObject({ status: 'error', attempts: 2, trigger: 'schedule', error: 'Upstream said no', hasResult: false });
      expect(fired).toEqual(['fail.js', 'fail.js']);
    });

    it('keeps results out of lists but returns them by id', async () => {
      await scheduler.startCron({ scriptPath: 'ok.js', data: { n: 1 } }, '0 1 * * *', 'ok');
      await scheduler.runNow('ok');
      await flush();

      const { runs } = await scheduler.listRuns({ status: 'success' });
      expect(runs[0]).toMatchObject({ taskName: 'ok', trigger: 'run-now', hasResult: true });
      expect(runs[0].result).toBeUndefined();
      expect((await scheduler.getRun(runs[0].executionId)).result).toEqual({ ok: true, data: { n: 1 } });
    });

    it('skips paused cron tasks and does not replay the paused minutes on resume', async () => {
      await scheduler.startCron({ scriptPath: 'a.js' }, '* * * * *', 'minutely');
      scheduler.evaluateCronTasks_(at(8, 1, 0));
      await flush();
      expect(fired).toHaveLength(1);

      await scheduler.pause('minutely');
      expect((await scheduler.getSchedule('minutely'))).toMatchObject({ enabled: false, nextRun: null });
      scheduler.evaluateCronTasks_(at(8, 2, 0));
      scheduler.evaluateCronTasks_(at(8, 3, 0));
      expect(fired).toHaveLength(1);

      await scheduler.resume('minutely');
      expect((await scheduler.getSchedule('minutely')).enabled).toBe(true);
      expect(await scheduler.pause('missing')).toBe(false);
    });

    it('can register an interval task paused', async () => {
      await scheduler.start('quiet', 'a.js', { x: 1 }, 30, undefined, { paused: true, group: 'G', description: 'd' });
      expect(fired).toHaveLength(0);
      expect(await scheduler.getSchedule('quiet')).toMatchObject({ enabled: false, group: 'G', description: 'd', data: { x: 1 } });
    });

    it('updates a task in place, switching type and keeping history', async () => {
      await scheduler.startCron({ scriptPath: 'a.js' }, '0 1 * * *', 'job');
      await scheduler.runNow('job');
      await flush();

      const asInterval = await scheduler.update('job', { intervalSeconds: 120, data: { v: 2 }, group: 'Ops' });
      expect(asInterval).toMatchObject({ type: 'interval', intervalSeconds: 120, data: { v: 2 }, group: 'Ops', executionCount: 1 });
      expect(asInterval.cron).toBeUndefined();

      const backToCron = await scheduler.update('job', { cron: '*/5 * * * *' });
      expect(backToCron).toMatchObject({ type: 'cron', cron: '*/5 * * * *' });
      expect((await scheduler.listRuns({ taskName: 'job' })).total).toBe(1);

      await expect(scheduler.update('job', { cron: 'nope' })).rejects.toThrow(/Invalid cron/);
      await expect(scheduler.update('job', { cron: '* * * * *', intervalSeconds: 5 })).rejects.toThrow(/not both/);
      expect((await scheduler.getSchedule('job')).cron).toBe('*/5 * * * *');
      expect(await scheduler.update('missing', {})).toBeNull();
    });

    it('records a skip when the concurrency cap is reached', async () => {
      await scheduler.saveSettings({ maxConcurrentJobs: 1 });
      await scheduler.startCron({ scriptPath: 'hang.js' }, '0 1 * * *', 'hog');
      await scheduler.startCron({ scriptPath: 'a.js' }, '0 1 * * *', 'starved');
      scheduler.evaluateCronTasks_(at(8, 1, 0));

      const { runs } = await scheduler.listRuns({ taskName: 'starved', status: 'skipped' });
      expect(runs).toHaveLength(1);
      expect(runs[0].error).toMatch(/maxConcurrentJobs/);
      expect((await scheduler.getSchedule('hog')).running).toBe(true);
    });

    it('forgets a task\'s runs when it is cancelled and reports stats', async () => {
      await scheduler.startCron({ scriptPath: 'fail.js' }, '0 1 * * *', 'a');
      await scheduler.startCron({ scriptPath: 'ok.js' }, '0 1 * * *', 'b');
      await scheduler.pause('b');
      await scheduler.runNow('a');
      for (let i = 0; i < 5; i++) await flush();

      expect(await scheduler.getStats()).toMatchObject({
        total: 2, enabled: 1, paused: 1, failing: 1, totalExecutions: 1, byType: { cron: 2, interval: 0 }
      });
      await scheduler.cancel('a');
      expect((await scheduler.listRuns()).total).toBe(0);
    });
  });

  describe('nextMatch', () => {
    it('resolves rare expressions and rejects impossible ones', () => {
      const leap = nextMatch('0 0 29 2 *', new Date(2026, 0, 1));
      expect([leap.getFullYear(), leap.getMonth(), leap.getDate()]).toEqual([2028, 1, 29]);
      expect(nextMatch('0 0 31 2 *')).toBeNull();
      expect(nextMatch('15 9 * * 1,3', new Date(2026, 8, 26, 12, 0)).getDay()).toBe(1);
    });
  });

  describe('REST routes', () => {
    let app;
    const B = '/services/scheduling/api';

    beforeEach(() => {
      app = express();
      app.use(express.json());
      registerManagerRoutes(app, null, scheduler);
    });

    it('creates, lists, edits, toggles and deletes tasks', async () => {
      await request(app).post(`${B}/tasks`).send({ name: 'n', scriptPath: 'a.js', cronExpression: '0 3 * * *', group: 'G', data: { a: 1 } }).expect(201);
      await request(app).post(`${B}/tasks`).send({ name: 'n', scriptPath: 'a.js', cronExpression: '0 3 * * *' }).expect(409);
      await request(app).post(`${B}/tasks`).send({ name: 'x', scriptPath: 'a.js' }).expect(400);
      await request(app).post(`${B}/tasks`).send({ name: 'x', scriptPath: 'a.js', cronExpression: '0 8 * * MON' }).expect(400);
      await request(app).post(`${B}/tasks`).send({ name: 'x', scriptPath: 'a.js', cronExpression: '0 0 31 2 *' }).expect(400);
      await request(app).post(`${B}/tasks`).send({ name: 'x', scriptPath: 'a.js', intervalSeconds: 0 }).expect(400);

      const created = await request(app).post(`${B}/tasks`).send({ name: 'int', scriptPath: 'a.js', intervalSeconds: 30, enabled: false }).expect(201);
      expect(created.body).toMatchObject({ type: 'interval', enabled: false });
      expect(fired).toHaveLength(0); // no immediate run from the UI

      const list = await request(app).get(`${B}/tasks`).expect(200);
      expect(list.body.map(t => t.name)).toEqual(['n', 'int']); // paused (no next run) last

      const edited = await request(app).put(`${B}/tasks/n`).send({ intervalSeconds: 90, description: 'd' }).expect(200);
      expect(edited.body).toMatchObject({ type: 'interval', intervalSeconds: 90, description: 'd', group: 'G' });

      const toggled = await request(app).post(`${B}/tasks/int/toggle`).send({}).expect(200);
      expect(toggled.body.enabled).toBe(true);

      await request(app).get(`${B}/tasks/stats`).expect(200);
      await request(app).delete(`${B}/tasks/int`).expect(200);
      await request(app).get(`${B}/tasks/int`).expect(404);
    });

    it('runs now, exposes run history and previews cron', async () => {
      await request(app).post(`${B}/tasks`).send({ name: 'f', scriptPath: 'fail.js', cronExpression: '0 3 * * *' }).expect(201);
      await request(app).post(`${B}/tasks/f/run-now`).expect(202);
      for (let i = 0; i < 5; i++) await flush();

      const runs = await request(app).get(`${B}/runs?taskName=f&status=failed`).expect(200);
      expect(runs.body.total).toBe(1);
      await request(app).get(`${B}/runs/${runs.body.runs[0].executionId}`).expect(200);
      await request(app).get(`${B}/runs/nope`).expect(404);

      const ok = await request(app).get(`${B}/cron/preview?expression=${encodeURIComponent('0 9 * * 1-5')}&count=2`).expect(200);
      expect(ok.body.valid).toBe(true);
      expect(ok.body.nextRuns).toHaveLength(2);
      const bad = await request(app).get(`${B}/cron/preview?expression=${encodeURIComponent('0 9 * * FRI')}`).expect(200);
      expect(bad.body).toMatchObject({ valid: false });
      expect(bad.body.error).toMatch(/dayOfWeek/);
    });
  });
});
