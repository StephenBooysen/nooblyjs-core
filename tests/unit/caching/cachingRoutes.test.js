/**
 * @fileoverview Unit tests for the caching service REST API, written with the
 * test kit (feature 11): a real registry with the memory cache, requests that
 * carry an API key, and cleanup under `.temp/`.
 *
 * @author NooblyJS Team
 * @since 1.0.0
 */

'use strict';

const { createTestRegistry, installMatchers } = require('../../../src/testing');

installMatchers();

describe('Caching routes', () => {
  let t;
  let cache;
  let other;
  const api = (method, path) => t.request(method, `/services/caching/api${path}`);

  beforeEach(async () => {
    t = await createTestRegistry({ services: ['caching'], name: `caching-routes-${process.pid}` });
    cache = t.registry.cache('memory');
    other = t.registry.cache('memory', { instanceName: 'other' });
  });
  afterEach(() => t.cleanup());

  it('reports status', async () => {
    expect((await api('get', '/status').expect(200)).body).toBe('caching api running');
  });

  it('puts, gets and deletes a value, emitting events', async () => {
    await api('post', '/put/k1').send({ a: 1 }).expect(200);
    expect(t.events).toHaveEmitted('cache:put:default', { key: 'k1' });
    expect((await api('get', '/get/k1').expect(200)).body).toEqual({ a: 1 });
    await api('delete', '/delete/k1').expect(200);
    expect(await cache.get('k1')).toBeFalsy();
  });

  it('routes named-instance requests to that instance', async () => {
    await api('post', '/other/put/k2').send({ b: 2 }).expect(200);
    expect(await other.get('k2')).toEqual({ b: 2 });
    expect(await cache.get('k2')).toBeFalsy();
    expect((await api('get', '/other/get/k2').expect(200)).body).toEqual({ b: 2 });
    await api('get', '/other/list').expect(200);
    await api('get', '/other/analytics').expect(200);
    await api('delete', '/other/delete/k2').expect(200);
    expect(await other.get('k2')).toBeFalsy();
  });

  it('falls back to the default instance for unknown names', async () => {
    await api('post', '/missing/put/k3').send({ c: 3 }).expect(200);
    expect(await cache.get('k3')).toEqual({ c: 3 });
  });

  it('lists instances from the registry without duplicating default', async () => {
    const res = await api('get', '/instances').expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.instances.map((i) => i.name)).toEqual(['default', 'other']);
  });

  it('returns analytics and the analytics list', async () => {
    await cache.put('x', 1);
    await cache.get('x');
    await cache.get('nope');
    expect((await api('get', '/analytics').expect(200)).body).toEqual(expect.objectContaining({
      stats: expect.any(Object),
      hitDistribution: expect.objectContaining({ labels: expect.arrayContaining(['x']) }),
      keyList: expect.any(Array),
      topMisses: expect.any(Array)
    }));
    expect((await api('get', '/list').expect(200)).body.success).toBe(true);
  });

  it('returns 503 when analytics are unavailable', async () => {
    const saved = cache.analytics;
    cache.analytics = null;
    await api('get', '/analytics').expect(503);
    cache.analytics = saved;
  });

  it('gets and saves settings', async () => {
    expect((await api('get', '/settings').expect(200)).body).toEqual(expect.any(Object));
    await api('post', '/settings').send({}).expect(200);
  });

  it('hides internal error messages on provider failure', async () => {
    for (const method of ['put', 'delete', 'getSettings']) jest.spyOn(cache, method).mockRejectedValue(new Error('secret internals'));
    const put = await api('post', '/put/k').send({}).expect(500);
    expect(JSON.stringify(put.body)).not.toContain('secret internals');
    await api('delete', '/delete/k').expect(500);
    await api('get', '/settings').expect(500);
  });

  it('rejects over-long keys', async () => {
    await api('post', `/put/${'k'.repeat(600)}`).send({}).expect(400);
  });
});
