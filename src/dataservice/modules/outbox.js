'use strict';

/**
 * @fileoverview Transactional outbox for the dataservice (feature 12).
 *
 * `addWithEvent` stores the event first, with a copy of the record, in the
 * outbox container. Then it stores the record. The relay publishes an event
 * only after its record exists. It writes the record itself when a crash
 * happened between the two writes, and it does this idempotently, because
 * both keys are chosen in advance.
 *
 * So no event is lost: once `addWithEvent` has returned, the event is durable
 * and the relay will publish it. Delivery is at least once. Each event has a
 * stable `id`, so consumers should deduplicate on it.
 *
 * @module dataservice/modules/outbox
 */

const crypto = require('node:crypto');

/** Container that holds pending outbox entries. */
const OUTBOX_CONTAINER = 'nooblyjs-core-outbox';

/**
 * Validates the arguments to addWithEvent.
 *
 * @param {string} container
 * @param {Object} record
 * @param {{name: string, payload?: *}} event
 * @throws {Error} When an argument is missing or malformed
 */
function validate(container, record, event) {
  if (typeof container !== 'string' || container.trim() === '' || container === OUTBOX_CONTAINER) {
    throw new Error('Invalid containerName: must be a non-empty string other than the outbox');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Invalid record: must be a non-null object');
  }
  if (!event || typeof event.name !== 'string' || event.name.trim() === '') {
    throw new Error('Invalid event: name must be a non-empty string');
  }
}

/**
 * Writes an event and its record. Returns once the event is durable.
 *
 * @param {Object} store A dataservice provider with addWithKey, getByUuid, remove and update
 * @param {string} container Container for the record
 * @param {Object} record The record to store
 * @param {{name: string, payload?: *}} event Event to publish after the record is stored
 * @return {Promise<{key: string, eventId: string}>} Record key and event id
 * @throws {Error} When an argument is invalid
 */
async function addWithEvent(store, container, record, event) {
  validate(container, record, event);
  const eventId = crypto.randomUUID();
  const recordKey = crypto.randomUUID();
  const entry = {
    id: eventId,
    container,
    recordKey,
    record: structuredClone(record),
    event: { name: event.name, payload: event.payload === undefined ? null : structuredClone(event.payload) },
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString()
  };

  // 1. The event is durable before anything else happens.
  await store.addWithKey(OUTBOX_CONTAINER, eventId, entry);
  // 2. The record. If the process stops here, the relay writes it.
  await store.addWithKey(container, recordKey, structuredClone(record));
  return { key: recordKey, eventId };
}

/**
 * Publishes pending outbox entries in creation order. A failing publish keeps
 * its entry for the next run and counts the attempt.
 *
 * @param {Object} store A dataservice provider
 * @param {function(Object): Promise<*>} publish Receives { id, name, payload, container, key, createdAt }
 * @param {Object=} options
 * @param {number=} options.limit Most entries handled in one run (default 100)
 * @return {Promise<{published: number, failed: number}>}
 */
async function relayOutbox(store, publish, options = {}) {
  if (typeof publish !== 'function') throw new Error('relayOutbox needs a publish function');
  const limit = options.limit === undefined ? 100 : options.limit;
  const pending = (await store.listAll(OUTBOX_CONTAINER))
    .filter((entry) => entry && entry.status === 'pending')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .slice(0, limit);

  let published = 0;
  let failed = 0;
  for (const entry of pending) {
    try {
      // Repair: the process may have stopped before the record was written.
      if (!(await store.getByUuid(entry.container, entry.recordKey))) {
        await store.addWithKey(entry.container, entry.recordKey, structuredClone(entry.record));
      }
      await publish({
        id: entry.id,
        name: entry.event.name,
        payload: entry.event.payload,
        container: entry.container,
        key: entry.recordKey,
        createdAt: entry.createdAt
      });
      await store.remove(OUTBOX_CONTAINER, entry.id);
      published += 1;
    } catch (error) {
      failed += 1;
      await store.update(OUTBOX_CONTAINER, entry.id, {
        ...entry,
        attempts: (entry.attempts || 0) + 1,
        lastError: error && error.name ? error.name : 'Error'
      }).catch(() => {});
    }
  }
  return { published, failed };
}

module.exports = { OUTBOX_CONTAINER, addWithEvent, relayOutbox };
