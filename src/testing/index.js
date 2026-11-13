/**
 * @fileoverview Test kit for apps built on NooblyJS Core (feature 11).
 *
 * `createTestRegistry()` gives a test an Express app, an event recorder and a
 * registry with the services it asks for, using in-memory providers and temp
 * directories under `.temp/tests/data/`. `cleanup()` resets the registry and
 * removes the temp directory, so Jest's open-handle checks stay quiet.
 *
 * Usage (Jest):
 *   const { createTestRegistry, installMatchers } = require('nooblyjs-core/testing');
 *   installMatchers();
 *   let t;
 *   beforeEach(async () => { t = await createTestRegistry({ services: ['caching'] }); });
 *   afterEach(() => t.cleanup());
 *   it('caches', async () => {
 *     await t.registry.cache('memory').put('k', 1);
 *     expect(t.events).toHaveEmitted('cache:put:default', { key: 'k' });
 *   });
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { EventEmitter } = require('node:events');

const TEST_API_KEY = 'nooblyjs-test-key';

/** Services a test can ask for, mapped to how each is created with in-memory providers. */
const FACTORIES = {
  logging: (r) => r.logger('memory'),
  caching: (r) => r.cache('memory'),
  queueing: (r) => r.queue('memory'),
  dataservice: (r) => r.dataService('memory'),
  scheduling: (r) => r.scheduling('memory'),
  searching: (r) => r.searching('memory'),
  measuring: (r) => r.measuring('memory'),
  working: (r) => r.working('memory'),
  workflow: (r) => r.workflow('memory'),
  notifying: (r) => r.notifying('memory'),
  fetching: (r) => r.fetching('node')
};

/** Records every event emitted on the shared emitter, in order. */
class EventRecorder {
  constructor(emitter) {
    this.entries = [];
    const original = emitter.emit.bind(emitter);
    emitter.emit = (event, ...args) => {
      this.entries.push({ event, payload: args[0] });
      return original(event, ...args);
    };
  }

  /** @return {string[]} Names of the recorded events */
  names() {
    return this.entries.map((e) => e.event);
  }

  /**
   * Finds recorded events by name.
   * @param {string} event Event name
   * @return {Array<*>} Payloads, oldest first
   */
  payloadsOf(event) {
    return this.entries.filter((e) => e.event === event).map((e) => e.payload);
  }
}

/**
 * Creates a test registry.
 *
 * @param {Object} [options]
 * @param {string[]} [options.services=[]] Services to create with in-memory providers
 * @param {string} [options.name] Temp directory name under `.temp/tests/data/`
 * @param {Object} [options.registry] Registry instance to use (defaults to the core singleton)
 * @return {Promise<{registry: Object, app: Object, events: EventRecorder, request: Function, dir: string, cleanup: Function}>}
 * @throws {Error} When a service name is not known
 */
async function createTestRegistry({ services = [], name = `kit-${process.pid}-${Date.now()}`, registry: given } = {}) {
  // Temp data lives under .temp/ (git-ignored), never in the repo root or the system temp dir.
  const dir = path.join(process.cwd(), '.temp', 'tests', 'data', name);
  fs.mkdirSync(dir, { recursive: true });

  const registry = given || require('../../index');
  const app = express();
  app.use(express.json());
  const emitter = new EventEmitter();
  const events = new EventRecorder(emitter);

  registry.initialize(app, emitter, {
    logDir: path.join(dir, 'logs'),
    dataDir: path.join(dir, 'data'),
    apiKeys: [TEST_API_KEY],
    requireApiKey: true
  });

  for (const service of services) {
    const make = FACTORIES[service];
    if (!make) throw new Error(`createTestRegistry: unknown service "${service}"`);
    make(registry);
  }

  // supertest is a dev dependency, so it is loaded only when a test asks for requests.
  const request = (method = 'get', url = '/') => require('supertest')(app)[method](url).set('x-api-key', TEST_API_KEY);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await registry.shutdown?.();
    } finally {
      registry.reset?.();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  return { registry, app, events, request, dir, apiKey: TEST_API_KEY, cleanup };
}

/**
 * Adds Jest matchers for events: `expect(t.events).toHaveEmitted(name, partial?)`.
 * The partial payload is matched with `toMatchObject`.
 */
function installMatchers() {
  expect.extend({
    toHaveEmitted(recorder, event, partial) {
      const payloads = recorder.payloadsOf(event);
      const pass = payloads.some((p) => {
        if (partial === undefined) return true;
        try {
          expect(p).toMatchObject(partial);
          return true;
        } catch (_err) {
          return false;
        }
      });
      const seen = recorder.names().join(', ') || '(none)';
      return {
        pass,
        message: () => (pass
          ? `expected no "${event}" event matching ${JSON.stringify(partial)}`
          : `expected a "${event}" event matching ${JSON.stringify(partial)}. Emitted: ${seen}`)
      };
    }
  });
}

module.exports = { createTestRegistry, installMatchers, EventRecorder, TEST_API_KEY };
