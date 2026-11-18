/**
 * @fileoverview Unit tests for the workflow manager: workflow CRUD with groups
 * and stars, execution history and last runs, schedules and the scheduler's
 * timing rules, state export/import, and the manager REST routes.
 *
 * @author NooblyJS Team
 * @since 1.1.0
 */

'use strict';

const EventEmitter = require('events');
const express = require('express');
const request = require('supertest');
const createWorkflowService = require('../../../src/workflow');
const { nextCronMatch } = require('../../../src/workflow/modules/workflowScheduler');

/**
 * A working service double: steps whose path contains "fail" error, "slow"
 * steps wait until released, everything else completes after a tick.
 * @return {{service: Object, release: function()}}
 */
function createWorkingDouble() {
  const waiting = [];
  const service = {
    start: jest.fn((stepPath, data, callback) => {
      if (stepPath.includes('slow')) {
        waiting.push(() => callback('completed', { slow: true }));
        return;
      }
      setImmediate(() => {
        if (stepPath.includes('fail')) callback('error', 'Step exploded');
        else callback('completed', { ran: stepPath });
      });
    })
  };
  return {
    service,
    release: () => { while (waiting.length) waiting.shift()(); }
  };
}

/** Waits for pending callbacks and promise continuations. */
const flush = () => new Promise(resolve => setImmediate(resolve));

/**
 * Waits until a predicate holds, polling on the event loop.
 * @param {function(): boolean} predicate - Condition
 */
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await flush();
  }
  throw new Error('Condition not met');
}

describe('Workflow manager', () => {
  let workflow;
  let emitter;
  let working;

  const make = (options = {}) => createWorkflowService('memory', {
    autoStartScheduler: false,
    ...options,
    dependencies: { working: working.service }
  }, emitter);

  beforeEach(() => {
    emitter = new EventEmitter();
    jest.spyOn(emitter, 'emit');
    working = createWorkingDouble();
    workflow = make();
  });

  afterEach(() => {
    workflow.shutdown();
  });

  describe('workflows', () => {
    it('creates workflows with group, tags and default input, sorted by group then name', async () => {
      await workflow.createWorkflow({ name: 'b-flow', group: 'Ingest', steps: ['a.js'] });
      await workflow.createWorkflow({ name: 'a-flow', group: 'Ingest', steps: ['a.js'], tags: ['x'] });
      await workflow.createWorkflow({ name: 'report', group: 'Reporting', steps: ['a.js'], defaultInput: { k: 1 } });

      const list = workflow.listWorkflows();
      expect(list.map(w => w.name)).toEqual(['a-flow', 'b-flow', 'report']);
      expect(list[0]).toMatchObject({ id: 'a-flow', group: 'Ingest', tags: ['x'], stepCount: 1, status: null, starred: false });
      expect(workflow.listGroups()).toEqual(['Ingest', 'Reporting']);
      expect(workflow.getWorkflow('report').defaultInput).toEqual({ k: 1 });
      expect(emitter.emit).toHaveBeenCalledWith('workflow:state:changed', expect.objectContaining({ kind: 'workflows' }));
    });

    it('rejects duplicates, invalid data and unknown workflows with HTTP-style status codes', async () => {
      await workflow.createWorkflow({ name: 'one', steps: ['a.js'] });
      await expect(workflow.createWorkflow({ name: 'one', steps: ['a.js'] })).rejects.toMatchObject({ statusCode: 409 });
      await expect(workflow.createWorkflow({ name: '', steps: ['a.js'] })).rejects.toMatchObject({ statusCode: 400 });
      await expect(workflow.createWorkflow({ name: 'x', steps: [] })).rejects.toMatchObject({ statusCode: 400 });
      await expect(workflow.createWorkflow({ name: 'x', steps: [''] })).rejects.toMatchObject({ statusCode: 400 });
      expect(() => workflow.getWorkflow('missing')).toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('filters by search, starred and tag', async () => {
      await workflow.createWorkflow({ name: 'crm-sync', description: 'Pull from CRM', steps: ['a.js'], tags: ['nightly'] });
      await workflow.createWorkflow({ name: 'report', steps: ['a.js'] });
      workflow.setStarred('report', true);

      expect(workflow.listWorkflows({ search: 'crm' }).map(w => w.name)).toEqual(['crm-sync']);
      expect(workflow.listWorkflows({ starred: true }).map(w => w.name)).toEqual(['report']);
      expect(workflow.listWorkflows({ tags: ['nightly'] }).map(w => w.name)).toEqual(['crm-sync']);
    });

    it('renames a workflow, carrying its history, schedules and star', async () => {
      await workflow.createWorkflow({ name: 'old', steps: ['a.js'] });
      workflow.setStarred('old', true);
      await workflow.executeWorkflow('old', {});
      const schedule = workflow.createSchedule({ workflowName: 'old', cronExpression: '0 2 * * *' });

      const renamed = await workflow.updateWorkflow('old', { name: 'new', description: 'd' });

      expect(renamed).toMatchObject({ name: 'new', description: 'd', starred: true, status: 'active' });
      expect(workflow.workflows.has('old')).toBe(false);
      expect(workflow.listExecutions({ workflowName: 'new' }).total).toBe(1);
      expect(workflow.getSchedule(schedule.id).workflowName).toBe('new');
    });

    it('deletes a workflow together with its schedules and history', async () => {
      await workflow.createWorkflow({ name: 'gone', steps: ['a.js'] });
      await workflow.executeWorkflow('gone', {});
      workflow.createSchedule({ workflowName: 'gone', interval: 60000 });

      const result = await workflow.deleteWorkflow('gone');

      expect(result).toEqual({ deleted: true, schedulesRemoved: 1, executionsRemoved: 1 });
      expect(workflow.listSchedules()).toHaveLength(0);
      expect(workflow.listExecutions().total).toBe(0);
    });

    it('exports and re-imports a workflow, refusing to overwrite unless asked', async () => {
      await workflow.createWorkflow({ name: 'portable', group: 'G', steps: ['a.js', 'b.js'], tags: ['t'] });
      const exported = workflow.exportWorkflow('portable');
      expect(exported).toMatchObject({ name: 'portable', group: 'G', steps: ['a.js', 'b.js'], tags: ['t'] });

      await expect(workflow.importWorkflow(exported)).rejects.toMatchObject({ statusCode: 409 });
      const replaced = await workflow.importWorkflow({ ...exported, steps: ['c.js'] }, { overwrite: true });
      expect(replaced.steps).toEqual(['c.js']);
    });
  });

  describe('executions', () => {
    beforeEach(async () => {
      await workflow.createWorkflow({ name: 'ok', group: 'G', steps: ['a.js', 'b.js'], defaultInput: { fromDefault: true } });
      await workflow.createWorkflow({ name: 'bad', steps: ['a.js', 'fail.js'] });
    });

    it('records a successful run with its trigger and uses the default input when none is given', async () => {
      const execution = await workflow.executeWorkflow('ok', {});

      expect(execution).toMatchObject({
        workflowName: 'ok', status: 'completed', outcome: 'success', trigger: 'manual', group: 'G', stepCount: 2
      });
      expect(execution.inputData).toEqual({ fromDefault: true });
      expect(execution.stepExecutions).toHaveLength(2);
    });

    it('resolves (not rejects) with the failed record when a step fails', async () => {
      const execution = await workflow.executeWorkflow('bad', { a: 1 });
      expect(execution).toMatchObject({ status: 'error', outcome: 'failed', error: 'Step exploded' });
      expect(workflow.getExecution(execution.executionId).stepExecutions[1].status).toBe('error');
    });

    it('shows a run as running while in flight, then replaces it in place', async () => {
      await workflow.createWorkflow({ name: 'slow', steps: ['slow.js'] });
      const { executionId, done } = workflow.startExecution('slow', {});
      await flush();

      expect(workflow.getExecution(executionId)).toMatchObject({ status: 'running', outcome: 'running', currentStep: 1 });
      expect(workflow.listExecutions({ status: 'running' }).total).toBe(1);

      working.release();
      await done;
      expect(workflow.getExecution(executionId).status).toBe('completed');
      expect(workflow.listExecutions({ workflowName: 'slow' }).total).toBe(1);
    });

    it('cancels a run before its next step', async () => {
      await workflow.createWorkflow({ name: 'two-slow', steps: ['slow.js', 'a.js'] });
      const { executionId, done } = workflow.startExecution('two-slow', {});
      await flush();

      expect(workflow.cancelExecution(executionId)).toEqual({ cancelling: true, executionId });
      working.release();
      const execution = await done;

      expect(execution).toMatchObject({ status: 'cancelled', outcome: 'cancelled' });
      expect(execution.stepExecutions).toHaveLength(1);
      expect(() => workflow.cancelExecution(executionId)).toThrow(expect.objectContaining({ statusCode: 409 }));
    });

    it('lists summaries without payloads, and returns the full record by id', async () => {
      const execution = await workflow.executeWorkflow('ok', {});
      const [row] = workflow.listExecutions().executions;

      expect(row).toMatchObject({ executionId: execution.executionId, hasResult: true });
      expect(row.outputData).toBeUndefined();
      expect(row.stepExecutions).toBeUndefined();
      expect(workflow.getExecution(execution.executionId).outputData).toBeDefined();
    });

    it('reports the latest run per workflow', async () => {
      await workflow.executeWorkflow('ok', {});
      await workflow.executeWorkflow('bad', {});
      const last = workflow.getLastRuns();

      expect(last.ok).toMatchObject({ outcome: 'success', trigger: 'manual' });
      expect(last.bad).toMatchObject({ outcome: 'failed', error: 'Step exploded' });
    });

    it('scopes history to one workflow with whole-window stats and a status filter', async () => {
      await workflow.executeWorkflow('ok', {});
      await workflow.executeWorkflow('ok', {});
      // An old run outside a 7-day window.
      workflow.executionContainer.record('ok', {
        executionId: 'old-run', status: 'error', startedAt: new Date(Date.now() - 10 * 86400000).toISOString()
      });

      const week = workflow.listWorkflowExecutions('ok', { days: 7 });
      expect(week.stats).toMatchObject({ total: 2, succeeded: 2, failed: 0, successRate: 100 });
      expect(week.window).toMatchObject({ days: 7, matched: 2, truncated: false });

      const all = workflow.listWorkflowExecutions('ok', { days: 0, status: 'failed' });
      expect(all.executions.map(e => e.executionId)).toEqual(['old-run']);
      expect(all.stats.total).toBe(3);

      const capped = workflow.listWorkflowExecutions('ok', { days: 0, limit: 1 });
      expect(capped.window).toMatchObject({ matched: 3, truncated: true });
    });

    it('deletes and clears finished history but never a running run', async () => {
      const done = await workflow.executeWorkflow('ok', {});
      await workflow.createWorkflow({ name: 'slow', steps: ['slow.js'] });
      const running = workflow.startExecution('slow', {});
      await flush();

      expect(() => workflow.deleteExecution(running.executionId)).toThrow(expect.objectContaining({ statusCode: 409 }));
      expect(workflow.deleteExecution(done.executionId)).toBe(true);
      await workflow.executeWorkflow('bad', {});
      expect(workflow.clearExecutions()).toBe(1);
      expect(workflow.listExecutions().total).toBe(1);

      working.release();
      await running.done;
    });
  });

  describe('schedules', () => {
    beforeEach(async () => {
      await workflow.createWorkflow({ name: 'job', steps: ['a.js'] });
      await workflow.createWorkflow({ name: 'broken', steps: ['fail.js'] });
    });

    it('creates a cron schedule with a computed next run and marks the workflow active', () => {
      const schedule = workflow.createSchedule({ workflowName: 'job', cronExpression: '0 2 * * *', input: { a: 1 } });

      expect(schedule).toMatchObject({ workflowName: 'job', workflowId: 'job', name: 'job', enabled: true, input: { a: 1 } });
      const next = new Date(schedule.nextRun);
      expect(next.getHours()).toBe(2);
      expect(next.getMinutes()).toBe(0);
      expect(next.getTime()).toBeGreaterThan(Date.now());
      expect(workflow.getWorkflow('job').status).toBe('active');
    });

    it('validates cadence, input and workflow', () => {
      const bad = data => () => workflow.createSchedule({ workflowName: 'job', ...data });
      expect(bad({})).toThrow(expect.objectContaining({ statusCode: 400 }));
      expect(bad({ cronExpression: '0 8 * * MON-FRI' })).toThrow(/Invalid cron expression/);
      expect(bad({ cronExpression: '0 0 31 2 *' })).toThrow(/never fires/);
      expect(bad({ cronExpression: '* * * * *', interval: 60000 })).toThrow(/not both/);
      expect(bad({ interval: 10 })).toThrow(/Interval/);
      expect(bad({ cronExpression: '* * * * *', input: [1] })).toThrow(/input/);
      expect(() => workflow.createSchedule({ workflowName: 'nope', interval: 60000 }))
        .toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('pausing clears the next run and enabling re-plans it from now', () => {
      const s = workflow.createSchedule({ workflowName: 'job', cronExpression: '*/5 * * * *' });
      const paused = workflow.toggleSchedule(s.id);
      expect(paused).toMatchObject({ enabled: false, nextRun: null });
      expect(workflow.getWorkflow('job').status).toBe('inactive');

      const enabled = workflow.toggleSchedule(s.id);
      expect(enabled.enabled).toBe(true);
      expect(new Date(enabled.nextRun).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects an invalid update without changing the schedule', () => {
      const s = workflow.createSchedule({ workflowName: 'job', cronExpression: '0 2 * * *' });
      expect(() => workflow.updateSchedule(s.id, { cronExpression: 'nonsense' })).toThrow();
      expect(workflow.getSchedule(s.id).cronExpression).toBe('0 2 * * *');

      const switched = workflow.updateSchedule(s.id, { interval: 120000, name: 'renamed' });
      expect(switched).toMatchObject({ cronExpression: null, interval: 120000, name: 'renamed' });
    });

    it('records run-now outcomes on the schedule and tags the execution', async () => {
      const s = workflow.createSchedule({ workflowName: 'broken', interval: 3600000, name: 'Hourly broken' });
      const { done } = workflow.runScheduleNow(s.id);
      const execution = await done;

      expect(execution).toMatchObject({ trigger: 'run-now', scheduleId: s.id, scheduleName: 'Hourly broken', outcome: 'failed' });
      expect(workflow.getSchedule(s.id)).toMatchObject({
        lastResult: 'failed', lastError: 'Step exploded', executionCount: 1, lastExecutionId: execution.executionId
      });
      expect(workflow.getScheduleStats()).toMatchObject({ total: 1, failing: 1, totalExecutions: 1 });
    });
  });

  describe('scheduler timing', () => {
    let schedule;

    beforeEach(async () => {
      await workflow.createWorkflow({ name: 'job', steps: ['a.js'] });
      schedule = workflow.createSchedule({ workflowName: 'job', cronExpression: '0 * * * *' });
    });

    it('fires a due schedule once and advances nextRun before dispatching', async () => {
      const due = new Date(schedule.nextRun).getTime();
      const result = workflow.scheduler.tick(due + 1000);

      expect(result.fired).toBe(1);
      expect(new Date(workflow.getSchedule(schedule.id).nextRun).getTime()).toBeGreaterThan(due);
      expect(workflow.scheduler.tick(due + 2000).fired).toBe(0);

      await until(() => workflow.getSchedule(schedule.id).executionCount === 1);
      expect(workflow.getSchedule(schedule.id).lastResult).toBe('success');
      expect(workflow.listExecutions().executions[0].trigger).toBe('schedule');
    });

    it('replays a missed fire once as a catch-up run', async () => {
      const due = new Date(schedule.nextRun).getTime();
      const result = workflow.scheduler.tick(due + 30 * 60 * 1000);

      expect(result).toMatchObject({ fired: 0, caughtUp: 1 });
      await until(() => workflow.getSchedule(schedule.id).executionCount === 1);
      expect(workflow.listExecutions().executions[0].trigger).toBe('catch-up');
    });

    it('only repairs nextRun for a missed fire when catch-up is off', async () => {
      await workflow.saveSettings({ scheduleCatchUp: false });
      const due = new Date(schedule.nextRun).getTime();
      const result = workflow.scheduler.tick(due + 30 * 60 * 1000);

      expect(result).toMatchObject({ caughtUp: 0, missed: 1 });
      expect(emitter.emit).toHaveBeenCalledWith('workflow:schedule:missed', expect.objectContaining({ scheduleId: schedule.id }));
      await flush();
      expect(workflow.listExecutions().total).toBe(0);
    });

    it('skips a fire while the previous run is still in flight', async () => {
      await workflow.updateWorkflow('job', { steps: ['slow.js'] });
      const due = new Date(schedule.nextRun).getTime();
      workflow.scheduler.tick(due + 1000);
      await flush();

      const next = new Date(workflow.getSchedule(schedule.id).nextRun).getTime();
      const result = workflow.scheduler.tick(next + 1000);
      expect(result.skipped).toBe(1);
      expect(emitter.emit).toHaveBeenCalledWith('workflow:schedule:skipped', expect.objectContaining({ reason: 'previous-run-in-flight' }));

      working.release();
      await until(() => workflow.getSchedule(schedule.id).executionCount === 1);
    });

    it('finds rare cron matches and rejects impossible ones', () => {
      const leap = nextCronMatch('0 0 29 2 *', new Date(2026, 0, 1));
      expect(leap.getFullYear()).toBe(2028);
      expect(leap.getMonth()).toBe(1);
      expect(leap.getDate()).toBe(29);
      expect(nextCronMatch('0 0 31 2 *')).toBeNull();
      const weekday = nextCronMatch('30 6 * * 1-5', new Date(2026, 8, 26, 12, 0)); // a Saturday
      expect(weekday.getDay()).toBe(1);
      expect(weekday.getHours()).toBe(6);
    });
  });

  describe('state export / import', () => {
    it('round-trips workflows, stars, schedules and history into a new instance', async () => {
      await workflow.createWorkflow({ name: 'job', group: 'G', steps: ['a.js'] });
      workflow.setStarred('job', true);
      await workflow.executeWorkflow('job', {});
      const s = workflow.createSchedule({ workflowName: 'job', cronExpression: '0 2 * * *' });

      const snapshot = JSON.parse(JSON.stringify(workflow.exportState()));
      const restored = make({ state: snapshot });

      expect(restored.getWorkflow('job')).toMatchObject({ group: 'G', starred: true, status: 'active' });
      expect(restored.getSchedule(s.id).cronExpression).toBe('0 2 * * *');
      expect(restored.listExecutions().total).toBe(1);
      await expect(restored.executeWorkflow('job', {})).resolves.toMatchObject({ outcome: 'success' });
      restored.shutdown();
    });

    it('imports in-flight runs as interrupted failures', () => {
      const counts = workflow.importState({
        workflows: { job: { steps: ['a.js'], metadata: {} } },
        executions: { job: [{ executionId: 'e1', status: 'running', startedAt: new Date().toISOString() }] }
      });

      expect(counts).toMatchObject({ workflows: 1, executions: 1 });
      expect(workflow.getExecution('e1')).toMatchObject({ status: 'error', outcome: 'failed' });
      expect(workflow.getExecution('e1').error).toMatch(/Interrupted/);
    });

    it('can omit history from the export', async () => {
      await workflow.createWorkflow({ name: 'job', steps: ['a.js'] });
      await workflow.executeWorkflow('job', {});
      expect(workflow.exportState({ includeExecutions: false }).executions).toEqual({});
    });
  });

  describe('REST routes', () => {
    let app;
    const B = '/services/workflow/api';

    beforeEach(() => {
      workflow.shutdown();
      app = express();
      app.use(express.json());
      workflow = createWorkflowService('memory', {
        'express-app': app,
        autoStartScheduler: false,
        dependencies: { working: working.service }
      }, emitter);
    });

    it('serves the workflow lifecycle with the right status codes', async () => {
      const name = 'ingest/nightly';
      const path = `${B}/workflows/${encodeURIComponent(name)}`;

      await request(app).post(`${B}/workflows`).send({ name, group: 'G', steps: ['a.js'] }).expect(201);
      await request(app).post(`${B}/workflows`).send({ name, steps: ['a.js'] }).expect(409);
      await request(app).post(`${B}/workflows`).send({ name: 'x' }).expect(400);
      await request(app).get(`${B}/workflows/missing`).expect(404);

      const list = await request(app).get(`${B}/workflows`).expect(200);
      expect(list.body.map(w => w.name)).toEqual([name]);

      const run = await request(app).post(`${path}/execute`).send({ wait: true }).expect(200);
      expect(run.body.outcome).toBe('success');

      const bg = await request(app).post(`${path}/execute`).send({}).expect(202);
      expect(bg.body.executionId).toBeDefined();
      await until(() => workflow.getExecution(bg.body.executionId)?.status === 'completed');

      const last = await request(app).get(`${B}/workflows/last-runs`).expect(200);
      expect(last.body[name].outcome).toBe('success');

      const hist = await request(app).get(`${path}/executions?days=all&status=success`).expect(200);
      expect(hist.body.stats.total).toBe(2);

      await request(app).post(`${path}/star`).send({ starred: true }).expect(200);
      await request(app).put(path).send({ description: 'updated' }).expect(200);
      await request(app).get(`${path}/export`).expect(200).expect('content-disposition', /attachment/);
      await request(app).delete(path).expect(200);
      await request(app).get(path).expect(404);
    });

    it('serves runs, schedules, cron preview and state', async () => {
      await request(app).post(`${B}/workflows`).send({ name: 'job', steps: ['fail.js'] }).expect(201);

      const created = await request(app).post(`${B}/schedules`).send({ workflowName: 'job', cronExpression: '*/10 * * * *' }).expect(201);
      await request(app).post(`${B}/schedules`).send({ workflowName: 'job', cronExpression: 'bad' }).expect(400);
      const id = created.body.id;

      await request(app).post(`${B}/schedules/${id}/run-now`).expect(202);
      await until(() => workflow.getSchedule(id).executionCount === 1);

      const runs = await request(app).get(`${B}/runs?status=failed`).expect(200);
      expect(runs.body.total).toBe(1);
      const runId = runs.body.executions[0].executionId;
      await request(app).get(`${B}/runs/${runId}`).expect(200);
      await request(app).get(`${B}/runs/nope`).expect(404);
      await request(app).post(`${B}/runs/${runId}/cancel`).expect(409);
      expect((await request(app).get(`${B}/runs/stats`).expect(200)).body.failed).toBe(1);

      const toggled = await request(app).post(`${B}/schedules/${id}/toggle`).send({ enabled: false }).expect(200);
      expect(toggled.body.enabled).toBe(false);
      await request(app).put(`${B}/schedules/${id}`).send({ interval: 60000 }).expect(200);
      expect((await request(app).get(`${B}/schedules/stats`).expect(200)).body.byType.interval).toBe(1);

      const preview = await request(app).get(`${B}/cron/preview?expression=${encodeURIComponent('0 9 * * 1')}&count=2`).expect(200);
      expect(preview.body).toMatchObject({ valid: true });
      expect(preview.body.nextRuns).toHaveLength(2);

      const state = await request(app).get(`${B}/state`).expect(200);
      expect(state.body.schedules).toHaveLength(1);

      await request(app).post(`${B}/runs/clear`).send({}).expect(200, { deletedCount: 1 });
      await request(app).delete(`${B}/schedules/${id}`).expect(200);
      await request(app).get(`${B}/schedules/${id}`).expect(404);
    });
  });
});
