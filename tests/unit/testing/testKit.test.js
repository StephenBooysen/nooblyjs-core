/**
 * @fileoverview The test kit (feature 11): an isolated registry per test,
 * recorded events with the toHaveEmitted matcher, temporary files under
 * .temp/tests/data, and a cleanup that leaves nothing behind.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const fs = require('node:fs');
const { createTestRegistry, installMatchers, DATA_ROOT } = require('../../../testing');

installMatchers();

describe('test kit (feature 11)', () => {
  let t;

  afterEach(() => {
    t?.cleanup();
    t = null;
  });

  it('gives each test a working registry with the services it asked for', async () => {
    t = await createTestRegistry({ services: ['caching', 'dataservice'] });
    await t.registry.cache('memory').put('k', { n: 1 });
    expect(await t.registry.cache('memory').get('k')).toEqual({ n: 1 });
    // Dependencies (logging, queueing) come up too.
    const names = t.registry.listServices().map((key) => key.split(':')[0]);
    expect(names).toEqual(expect.arrayContaining(['caching', 'dataservice', 'logging', 'queueing']));
  });

  it('records emitted events, and matches them by name and partial payload', async () => {
    t = await createTestRegistry({ services: ['caching'] });
    await t.registry.cache('memory').put('order:1', 'paid');
    expect(t.events).toHaveEmitted('cache:put:default', { key: 'order:1' });
    expect(t.events).not.toHaveEmitted('cache:put:default', { key: 'order:2' });
    expect(t.events).not.toHaveEmitted('never:emitted');
  });

  it('explains a failed match with the events that were emitted', async () => {
    t = await createTestRegistry({ services: ['caching'] });
    await t.registry.cache('memory').put('a', 1);
    let message = '';
    try {
      expect(t.events).toHaveEmitted('cache:get:default');
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain('cache:get:default');
    expect(message).toContain('Emitted events');
  });

  it('rejects an unknown service name, listing the known ones', async () => {
    await expect(createTestRegistry({ services: ['blockchain'] })).rejects.toThrow('unknown service "blockchain"');
  });

  it('keeps temporary files under .temp/tests/data and removes them on cleanup', async () => {
    t = await createTestRegistry({ services: ['logging'] });
    expect(t.dir.startsWith(DATA_ROOT)).toBe(true);
    expect(fs.existsSync(t.dir)).toBe(true);
    const dir = t.dir;
    t.cleanup();
    expect(fs.existsSync(dir)).toBe(false);
    t.cleanup(); // a second cleanup is harmless
    t = null;
  });

  it('answers HTTP through supertest with the registry app', async () => {
    t = await createTestRegistry({ services: ['caching'] });
    t.app.get('/ping', (req, res) => res.json({ pong: true }));
    const res = await t.request().get('/ping').expect(200);
    expect(res.body).toEqual({ pong: true });
  });

  it('runs scripted AI replies through the mock provider', async () => {
    t = await createTestRegistry({ services: [] });
    const ai = t.aiservice([{ text: 'scripted' }]);
    const reply = await ai.complete({ prompt: 'hi' });
    expect(reply.text).toBe('scripted');
  });
});
