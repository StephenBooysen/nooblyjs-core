'use strict';

const Redis = require('ioredis');
const { EventEmitter } = require('node:events');
const SchedulerProvider = require('../../../src/scheduling/providers/scheduling');
const { parseCron } = require('../../../src/scheduling/providers/cronExpression');
const { createStateStore, MemoryStateStore } = require('../../../src/shared/utils/stateStore');

const redisUrl = process.env.REDIS_URL;
const runRedis = process.env.RUN_REDIS_TESTS === '1' && Boolean(redisUrl);
const describeRedis = runRedis ? describe : describe.skip;

/** Lets pending claim promises settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 60));

/** A replica: a scheduler with the same cron task, sharing the given state store. */
function replica(stateStore, taskName) {
  const provider = new SchedulerProvider({ stateStore }, new EventEmitter(), null);
  provider.tasks_.set(taskName, {
    name: taskName,
    type: 'cron',
    cron: '* * * * *',
    parsedCron: parseCron('* * * * *'),
    paused: false,
    lastFiredMinute: null,
    scriptPath: 'report.js'
  });
  provider.executeTask_ = jest.fn();
  return provider;
}

/** Ticks every replica through the same ten minutes. */
async function tenMinutes(replicas) {
  for (let minute = 0; minute < 10; minute += 1) {
    const now = new Date(Date.UTC(2026, 0, 1, 0, minute, 30));
    for (const provider of replicas) provider.evaluateCronTasks_(now);
    await flush();
  }
}

describe('cron fires across replicas (feature 21)', () => {
  describeRedis('with a shared Redis state store', () => {
    const clients = [];
    const connect = () => {
      const client = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
      clients.push(client);
      return createStateStore({ redisClient: client });
    };

    afterAll(async () => {
      for (const client of clients) await client.quit().catch(() => {});
    });

    it('runs a one-minute cron task exactly once per minute across two replicas', async () => {
      const taskName = `report-${Date.now()}`;
      const replicaA = replica(connect(), taskName);
      const replicaB = replica(connect(), taskName);

      await tenMinutes([replicaA, replicaB]);

      const runs = replicaA.executeTask_.mock.calls.length + replicaB.executeTask_.mock.calls.length;
      expect(runs).toBe(10);
    });
  });

  it('runs every fire on each replica when there is no shared store (single process behaviour)', async () => {
    const taskName = `local-${Date.now()}`;
    const replicaA = replica(new MemoryStateStore(), taskName);
    const replicaB = replica(new MemoryStateStore(), taskName);

    await tenMinutes([replicaA, replicaB]);

    expect(replicaA.executeTask_).toHaveBeenCalledTimes(10);
    expect(replicaB.executeTask_).toHaveBeenCalledTimes(10);
  });
});
