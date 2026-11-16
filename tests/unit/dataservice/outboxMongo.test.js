'use strict';

/**
 * @fileoverview Transactional outbox on MongoDB (feature 12). Opt-in: set
 * RUN_MONGODB_TESTS=1 and MONGODB_URL. Transactions need a replica set; the
 * standalone case is covered by the fallback test.
 */

const { EventEmitter } = require('node:events');
const createDataservice = require('../../../src/dataservice');
const { OUTBOX_CONTAINER } = require('../../../src/dataservice/modules/outbox');

const enabled = process.env.RUN_MONGODB_TESTS === '1' && Boolean(process.env.MONGODB_URL);
const describeMongo = enabled ? describe : describe.skip;

describeMongo('transactional outbox on MongoDB (feature 12)', () => {
  const database = `nooblyjs_outbox_${Date.now()}`;
  let store;

  beforeAll(async () => {
    store = createDataservice('mongodb', { connectionString: process.env.MONGODB_URL, database, dependencies: {} }, new EventEmitter());
    await store.provider.ensureConnection_();
  });

  afterAll(async () => {
    await store?.provider?.db_?.dropDatabase().catch(() => {});
    await store?.provider?.client_?.close().catch(() => {});
  });

  it('writes the record and its event together, and the relay publishes the event once', async () => {
    const published = [];
    const { key, eventId } = await store.addWithEvent('orders', { total: 9 }, { name: 'order.created', payload: { total: 9 } });
    expect(await store.getByUuid('orders', key)).toMatchObject({ total: 9 });
    // On a replica set the write is one transaction, not the ordered fallback.
    expect(store.provider.transactions_).toBe(true);
    const pendingBefore = (await store.listAll(OUTBOX_CONTAINER)).filter((e) => e.id === eventId);
    expect(pendingBefore).toHaveLength(1);

    const result = await store.relayOutbox(async (event) => { published.push(event); });
    expect(result.published).toBeGreaterThanOrEqual(1);
    expect(published.map((e) => e.id)).toContain(eventId);
    expect((await store.listAll(OUTBOX_CONTAINER)).some((e) => e.id === eventId)).toBe(false);
  });

  it('falls back to ordered writes when transactions are not available', async () => {
    store.provider.transactions_ = false;
    const { key, eventId } = await store.addWithEvent('orders', { total: 4 }, { name: 'order.paid' });
    expect(await store.getByUuid('orders', key)).toMatchObject({ total: 4 });
    expect((await store.listAll(OUTBOX_CONTAINER)).some((e) => e.id === eventId)).toBe(true);
    store.provider.transactions_ = undefined;
  });

  it('stores a key-addressed object, and a repeated key is not an error', async () => {
    const key = `k-${Date.now()}`;
    await store.addWithKey('widgets', key, { name: 'first' });
    await expect(store.addWithKey('widgets', key, { name: 'second' })).resolves.toBe(key);
    expect((await store.getByUuid('widgets', key)).name).toBe('first');
  });
});
