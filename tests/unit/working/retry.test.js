'use strict';

/**
 * @fileoverview working.start() retries (feature 06): an errored task is
 * queued again with backoff until its attempts are used up, and the
 * completion callback fires once with the final outcome.
 */

const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
const WorkerManager = require('../../../src/working/providers/working');
const Queueing = require('../../../src/queueing/providers/queueing');
const { testDataDir } = require('../../helpers/testData');

describe('working retries', () => {
  let dir;
  let manager;
  let events;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(testDataDir(), 'working-retry-'));
    fs.writeFileSync(path.join(dir, 'flaky.js'), `
      const fs = require('node:fs');
      async function run(data) {
        const n = Number(fs.existsSync(data.counter) ? fs.readFileSync(data.counter, 'utf8') : 0) + 1;
        fs.writeFileSync(data.counter, String(n));
        if (n < data.succeedOn) throw new Error('attempt ' + n + ' failed');
        return { attempts: n };
      }
      module.exports = { run };
    `);
    events = new EventEmitter();
    manager = new WorkerManager({
      dependencies: { queueing: new Queueing({}, events) },
      activitiesFolder: dir,
      enableLogging: false,
      backoff: { type: 'fixed', baseMs: 20 }
    }, events);
  });

  afterEach(async () => {
    await manager.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (data, options) => new Promise((resolve, reject) => {
    manager.start('flaky.js', data, (status, result) => resolve({ status, result }), options).catch(reject);
  });

  it('retries until it succeeds and calls back once', async () => {
    const retries = [];
    events.on('worker:retry', (e) => retries.push(e.attempt));
    const outcome = await run({ counter: path.join(dir, 'a.count'), succeedOn: 3 }, { attempts: 3 });
    expect(outcome).toEqual({ status: 'completed', result: { attempts: 3 } });
    expect(retries).toEqual([1, 2]);
  }, 20000);

  it('reports the last error when attempts run out', async () => {
    const outcome = await run({ counter: path.join(dir, 'b.count'), succeedOn: 10 }, { attempts: 2 });
    expect(outcome.status).toBe('error');
    expect(String(outcome.result)).toMatch(/attempt 2 failed/);
  }, 20000);

  it('does not retry by default', async () => {
    const outcome = await run({ counter: path.join(dir, 'c.count'), succeedOn: 2 });
    expect(outcome.status).toBe('error');
    expect(fs.readFileSync(path.join(dir, 'c.count'), 'utf8')).toBe('1');
  }, 20000);

  it('refuses a bad attempts value', async () => {
    await expect(manager.start('flaky.js', {}, undefined, { attempts: 0 })).rejects.toThrow('attempts');
  });
});
