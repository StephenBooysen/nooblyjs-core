/**
 * @fileoverview Test kit for apps built on NooblyJS (feature 11). Exported as
 * `nooblyjs-core/testing`:
 *
 *   const { createTestRegistry, installMatchers } = require('nooblyjs-core/testing');
 *   installMatchers();                       // adds toHaveEmitted to expect
 *   let t;
 *   beforeEach(async () => { t = await createTestRegistry({ services: ['caching'] }); });
 *   afterEach(() => t.cleanup());
 *
 *   it('caches orders', async () => {
 *     await t.registry.cache('memory').put('k', 1);
 *     expect(t.events).toHaveEmitted('cache:put:default', { key: 'k' });
 *   });
 *
 * The kit resets the shared registry, keeps temporary files under
 * `.temp/tests/data/`, records every event, and removes all of it in cleanup().
 * It needs Jest for the matchers and fake clock, and supertest for `request()`.
 *
 * @module testing
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const express = require('express');
const serviceRegistry = require('../../index');
const { matchers: matcherSet, install: installMatchers } = require('./matchers');

/** Where every test run keeps its temporary files (git-ignored). */
const DATA_ROOT = path.join(process.cwd(), '.temp', 'tests', 'data');

/**
 * Services the kit can create, with the factory that builds each one with its
 * memory provider.
 * @const {!Object<string, function(!Object): Object>}
 */
const FACTORIES = Object.freeze({
  logging: (r) => r.logger('memory'),
  caching: (r) => r.cache('memory'),
  queueing: (r) => r.queue('memory'),
  dataservice: (r) => r.dataService('memory'),
  searching: (r) => r.searching('memory'),
  measuring: (r) => r.measuring('memory'),
  scheduling: (r) => r.scheduling('memory'),
  notifying: (r) => r.notifying('memory')
});

/** Services created when the caller does not name any. */
const DEFAULT_SERVICES = Object.freeze(['logging', 'caching']);

/**
 * Creates an isolated test environment: a reset registry with the named
 * services (memory providers), an Express app, a recording event emitter and a
 * temporary data directory.
 *
 * @param {Object=} options
 * @param {Array<string>=} options.services Services to create (default: logging and caching).
 * @param {Object=} options.registryOptions Extra options for ServiceRegistry.initialize.
 * @return {Promise<{registry: Object, app: Object, events: EventEmitter, dir: string,
 *     aiservice: function(Array<Object>): Object, request: function(): Object,
 *     useFakeTimers: function(): void, advance: function(number): void, cleanup: function(): void}>}
 * @throws {Error} When a service name is not known to the kit.
 * @example
 * const t = await createTestRegistry({ services: ['caching', 'dataservice'] });
 * t.registry.cache('memory').put('k', 1);
 * t.cleanup();
 */
async function createTestRegistry(options = {}) {
  const names = options.services || DEFAULT_SERVICES;
  for (const name of names) {
    if (!FACTORIES[name]) throw new Error(`createTestRegistry: unknown service "${name}". Known: ${Object.keys(FACTORIES).join(', ')}`);
  }

  fs.mkdirSync(DATA_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(DATA_ROOT, 'kit-'));
  const app = express();
  app.use(express.json());

  const events = new EventEmitter();
  events.recorded = [];
  const emit = events.emit.bind(events);
  events.emit = (name, ...args) => {
    events.recorded.push({ name, args });
    return emit(name, ...args);
  };

  const registry = serviceRegistry;
  registry.reset();
  registry.initialize(app, events, {
    logDir: path.join(dir, 'logs'),
    dataDir: path.join(dir, 'data'),
    security: {
      apiKeyAuth: { requireApiKey: false, apiKeys: [] },
      servicesAuth: { requireLogin: false }
    },
    ...(options.registryOptions || {})
  });
  for (const name of names) FACTORIES[name](registry);

  let fakeTimers = false;
  let cleaned = false;

  return {
    registry,
    app,
    events,
    dir,

    /** Creates a mock AI service with scripted replies (see aiservice('mock')). */
    aiservice(script = [{ text: 'mock reply' }]) {
      return registry.aiservice('mock', { legacy: false, script });
    },

    /** A supertest agent for the app. */
    request() {
      try {
        return require('supertest')(app);
      } catch (error) {
        throw new Error('t.request() needs supertest: npm install --save-dev supertest');
      }
    },

    /** Switches Jest to fake timers, for delays in queues, schedules and workflows. */
    useFakeTimers() {
      if (typeof jest === 'undefined') throw new Error('t.useFakeTimers() needs Jest');
      jest.useFakeTimers();
      fakeTimers = true;
    },

    /** Moves the fake clock forward. */
    advance(ms) {
      if (!fakeTimers) throw new Error('Call t.useFakeTimers() before t.advance()');
      jest.advanceTimersByTime(ms);
    },

    /** Resets the registry, removes listeners, temporary files and fake timers. */
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (fakeTimers) jest.useRealTimers();
      registry.reset();
      events.removeAllListeners();
      events.recorded = [];
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

module.exports = { createTestRegistry, installMatchers, matchers: matcherSet, DATA_ROOT, FACTORIES };
