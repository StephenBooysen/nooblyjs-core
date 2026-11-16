'use strict';

/**
 * @fileoverview Interval tasks across replicas (feature 21). Each interval
 * window is claimed once in the shared store, so one replica runs each tick.
 */

const { EventEmitter } = require('node:events');
const SchedulerProvider = require('../../../src/scheduling/providers/scheduling');
const { MemoryStateStore } = require('../../../src/shared/utils/stateStore');

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

/** A replica with one interval task whose ticks are counted. */
function replica(stateStore, taskName) {
  const provider = new SchedulerProvider({ stateStore }, new EventEmitter(), null);
  provider.executeTask_ = jest.fn();
  const task = { name: taskName, type: 'interval', intervalSeconds: 60, paused: false, lastTickAt: null };
  provider.tasks_.set(taskName, task);
  return { provider, task, fire: provider.intervalFire_(task) };
}

describe('interval ticks across replicas (feature 21)', () => {
  let stores;
  beforeEach(() => { stores = new MemoryStateStore(); });

  it('runs each interval window once across two replicas', async () => {
    const a = replica(stores, 'sync');
    const b = replica(stores, 'sync');
    // Both replicas fire three times inside the same one-minute window.
    for (let i = 0; i < 3; i += 1) { a.fire(); b.fire(); }
    await flush();
    expect(a.provider.executeTask_.mock.calls.length + b.provider.executeTask_.mock.calls.length).toBe(1);
  });

  it('runs again in the next window', async () => {
    const a = replica(stores, 'digest');
    const b = replica(stores, 'digest');
    const realNow = Date.now;
    try {
      Date.now = () => 1_700_000_000_000;
      a.fire(); b.fire();
      await flush();
      Date.now = () => 1_700_000_000_000 + 60_000;
      a.fire(); b.fire();
      await flush();
    } finally {
      Date.now = realNow;
    }
    const total = a.provider.executeTask_.mock.calls.length + b.provider.executeTask_.mock.calls.length;
    expect(total).toBe(2);
  });

  it('keeps ticking locally when there is no shared store', () => {
    const provider = new SchedulerProvider({}, new EventEmitter(), null);
    provider.executeTask_ = jest.fn();
    const task = { name: 'local', type: 'interval', intervalSeconds: 60, paused: false };
    provider.intervalFire_(task)();
    expect(provider.executeTask_).toHaveBeenCalledTimes(1);
  });
});
