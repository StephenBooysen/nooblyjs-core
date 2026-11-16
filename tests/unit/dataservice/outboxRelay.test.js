/**
 * @fileoverview Scheduled outbox relay (feature 12): the dataservice factory
 * runs the relay on an interval, stops it on teardown, and exposes the outbox
 * methods. Clustered mode: one replica relays per window.
 */
'use strict';

const { EventEmitter } = require('node:events');
const createDataservice = require('../../../src/dataservice');
const { MemoryStateStore } = require('../../../src/shared/utils/stateStore');
const { startRelay } = require('../../../src/dataservice/modules/outbox');

const until = async (check, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return check();
};

describe('scheduled outbox relay (feature 12)', () => {
  let services = [];
  const make = (outbox) => {
    const emitter = new EventEmitter();
    const svc = createDataservice('memory', { dependencies: {}, outbox }, emitter);
    services.push(svc);
    return svc;
  };

  afterEach(async () => {
    for (const svc of services) await svc.stopConsumers?.();
    services = [];
  });

  it('exposes the outbox on the registry-level service', async () => {
    const svc = make();
    expect(typeof svc.addWithEvent).toBe('function');
    expect(typeof svc.relayOutbox).toBe('function');
    const { eventId } = await svc.addWithEvent('orders', { total: 1 }, { name: 'order.created' });
    expect(eventId).toEqual(expect.any(String));
  });

  it('publishes pending events on its own, without a manual call', async () => {
    const published = [];
    const svc = make({ intervalMs: 20, publish: async (event) => { published.push(event.name); } });
    await svc.addWithEvent('orders', { total: 2 }, { name: 'order.paid' });
    expect(await until(() => published.length === 1)).toBe(true);
    expect(published).toEqual(['order.paid']);
  });

  it('stops relaying once torn down', async () => {
    const published = [];
    const svc = make({ intervalMs: 20, publish: async (event) => { published.push(event); } });
    await svc.stopConsumers();
    await svc.addWithEvent('orders', { total: 3 }, { name: 'late' });
    await new Promise((r) => setTimeout(r, 80));
    expect(published).toHaveLength(0);
  });

  it('keeps a failing event pending and counts the attempt', async () => {
    const svc = make({ intervalMs: 20, publish: async () => { throw new Error('down'); } });
    await svc.addWithEvent('orders', { total: 4 }, { name: 'flaky' });
    await new Promise((r) => setTimeout(r, 80));
    const pending = (await svc.listAll('nooblyjs-core-outbox')).filter((e) => e.status === 'pending');
    expect(pending.length).toBe(1);
    expect(pending[0].attempts).toBeGreaterThan(0);
    expect(pending[0].lastError).toBe('Error');
  });

  it('rejects a relay without a positive interval', () => {
    expect(() => startRelay({}, async () => {}, { intervalMs: 0 })).toThrow(/positive intervalMs/);
  });

  it('with a shared state store, only one of two replicas relays each window', async () => {
    const stateStore = new MemoryStateStore();
    const published = [];
    const emitter = new EventEmitter();
    const a = createDataservice('memory', { dependencies: {}, outbox: { intervalMs: 60000, publish: async (e) => published.push(e) } }, emitter);
    services.push(a);
    // Two relays over the same store and provider, both forced to run in one window.
    const relayB = startRelay(a.provider, async (e) => published.push(e), { intervalMs: 60000, stateStore });
    const relayA = startRelay(a.provider, async (e) => published.push(e), { intervalMs: 60000, stateStore });
    await a.addWithEvent('orders', { total: 5 }, { name: 'shared' });
    const [ra, rb] = await Promise.all([relayA.runOnce(), relayB.runOnce()]);
    relayA.stop();
    relayB.stop();
    const runs = [ra, rb].filter(Boolean);
    expect(runs).toHaveLength(1);
    expect(published).toHaveLength(1);
  });
});
