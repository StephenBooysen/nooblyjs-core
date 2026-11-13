/**
 * @fileoverview The test kit (feature 11): a registry with the requested
 * services, event matchers, authenticated requests, and cleanup that removes
 * its temp directory.
 */
'use strict';

const fs = require('fs');
const { createTestRegistry, installMatchers } = require('../../../testing');

installMatchers();

describe('test kit (feature 11)', () => {
  let t;
  beforeEach(async () => {
    t = await createTestRegistry({ services: ['caching'], name: `kit-${Date.now()}` });
  });
  afterEach(async () => { await t.cleanup(); });

  it('creates the requested service with an in-memory provider', async () => {
    const cache = t.registry.cache('memory');
    await cache.put('k', 1);
    expect(await cache.get('k')).toBe(1);
  });

  it('records emitted events for matchers', async () => {
    await t.registry.cache('memory').put('order', { total: 9 });
    expect(t.events).toHaveEmitted('cache:put:default', { key: 'order' });
    expect(t.events).not.toHaveEmitted('cache:delete:default');
  });

  it('gives authenticated requests against the app', async () => {
    await t.request('get', '/services/caching/api/settings').expect(200);
    await require('supertest')(t.app).get('/services/caching/api/settings').expect(401);
  });

  it('refuses an unknown service name with a clear error', async () => {
    await expect(createTestRegistry({ services: ['nope'], name: 'kit-bad' })).rejects.toThrow(/unknown service "nope"/);
  });

  it('removes its temp directory and is safe to clean up twice', async () => {
    const dir = t.dir;
    expect(fs.existsSync(dir)).toBe(true);
    await t.cleanup();
    await t.cleanup();
    expect(fs.existsSync(dir)).toBe(false);
    t = await createTestRegistry({ services: [], name: `kit-again-${Date.now()}` });
  });
});
