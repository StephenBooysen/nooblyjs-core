'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const FileDataProvider = require('../../../src/dataservice/providers/dataservicefiles');
const MemoryDataProvider = require('../../../src/dataservice/providers/dataservice');
const { OUTBOX_CONTAINER } = require('../../../src/dataservice/modules/outbox');
const { testDataDir } = require('../../helpers/testData');

describe('transactional outbox (feature 12)', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(testDataDir('outbox'), 'nooblyjs-outbox-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const fileStore = () => new FileDataProvider({ dataDir: dir }, new EventEmitter());

  it('stores the record and an event, and publishes the event once', async () => {
    const store = fileStore();
    const { key, eventId } = await store.addWithEvent('orders', { total: 40 }, { name: 'order.created', payload: { total: 40 } });

    expect(await store.getByUuid('orders', key)).toEqual({ total: 40 });
    const published = [];
    expect(await store.relayOutbox(async (event) => published.push(event))).toEqual({ published: 1, failed: 0 });
    expect(published[0]).toMatchObject({ id: eventId, name: 'order.created', payload: { total: 40 }, container: 'orders', key });

    // Published entries leave the outbox, so a second run publishes nothing.
    expect(await store.relayOutbox(async () => { throw new Error('should not run'); })).toEqual({ published: 0, failed: 0 });
  });

  it('does not lose the event when the process stops between the event write and the record write', async () => {
    const store = fileStore();
    // Simulate a crash after step 1: the outbox entry exists, the record does not.
    const eventId = 'evt-crash-1';
    const recordKey = 'rec-crash-1';
    await store.addWithKey(OUTBOX_CONTAINER, eventId, {
      id: eventId,
      container: 'orders',
      recordKey,
      record: { total: 99 },
      event: { name: 'order.created', payload: { total: 99 } },
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString()
    });
    expect(await store.getByUuid('orders', recordKey)).toBeFalsy();

    // A fresh process (new provider over the same files) relays the outbox.
    const restarted = fileStore();
    const published = [];
    await restarted.relayOutbox(async (event) => published.push(event));

    expect(published.map((e) => e.id)).toEqual([eventId]);
    expect(await restarted.getByUuid('orders', recordKey)).toEqual({ total: 99 });
  });

  it('keeps a failed event for the next run and counts the attempt', async () => {
    const store = fileStore();
    const { eventId } = await store.addWithEvent('orders', { id: 1 }, { name: 'order.paid' });

    const first = await store.relayOutbox(async () => { throw new TypeError('broker down'); });
    expect(first).toEqual({ published: 0, failed: 1 });

    const entry = (await store.listAll(OUTBOX_CONTAINER)).find((e) => e.id === eventId);
    expect(entry).toMatchObject({ attempts: 1, lastError: 'TypeError', status: 'pending' });

    const second = [];
    expect(await store.relayOutbox(async (event) => second.push(event))).toEqual({ published: 1, failed: 0 });
  });

  it('gives each event a stable id, so consumers can deduplicate', async () => {
    const store = fileStore();
    const { eventId } = await store.addWithEvent('orders', { id: 2 }, { name: 'order.created' });
    const seen = [];
    await store.relayOutbox(async (event) => seen.push(event.id));
    expect(seen).toEqual([eventId]);
    expect(typeof eventId).toBe('string');
  });

  it('refuses invalid input', async () => {
    const store = fileStore();
    await expect(store.addWithEvent('', {}, { name: 'x' })).rejects.toThrow(/containerName/);
    await expect(store.addWithEvent('orders', null, { name: 'x' })).rejects.toThrow(/record/);
    await expect(store.addWithEvent('orders', {}, {})).rejects.toThrow(/event/);
    await expect(store.addWithEvent(OUTBOX_CONTAINER, {}, { name: 'x' })).rejects.toThrow(/containerName/);
  });

  it('works on the memory provider too', async () => {
    const store = new MemoryDataProvider({}, new EventEmitter());
    const { key } = await store.addWithEvent('orders', { total: 5 }, { name: 'order.created' });
    expect(await store.getByUuid('orders', key)).toEqual({ total: 5 });
    const published = [];
    await store.relayOutbox(async (event) => published.push(event.name));
    expect(published).toEqual(['order.created']);
  });
});
