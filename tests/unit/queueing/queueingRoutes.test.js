/**
 * @fileoverview Unit tests for the queueing service REST API, written with the
 * test kit (feature 11): a real registry with the memory queue, requests that
 * carry an API key, and cleanup under `.temp/`.
 *
 * @author NooblyJS Team
 * @since 1.0.0
 */

'use strict';

const { createTestRegistry, installMatchers } = require('../../../src/testing');

installMatchers();

describe('Queueing routes', () => {
  let t;
  let queue;
  let other;
  const api = (method, path) => t.request(method, `/services/queueing/api${path}`);

  beforeEach(async () => {
    t = await createTestRegistry({ services: ['queueing'], name: `queueing-routes-${process.pid}` });
    queue = t.registry.queue('memory');
    other = t.registry.queue('memory', { instanceName: 'other' });
  });
  afterEach(() => t.cleanup());

  it('reports status', async () => {
    expect((await api('get', '/status').expect(200)).body).toBe('queueing api running');
  });

  it('enqueues, sizes, lists, dequeues and purges', async () => {
    await api('post', '/enqueue/jobs').send({ task: { id: 1 } }).expect(200);
    await api('post', '/enqueue/jobs').send({ task: { id: 2 } }).expect(200);
    expect((await api('get', '/size/jobs').expect(200)).body).toBe(2);
    expect((await api('get', '/queues').expect(200)).body).toContain('jobs');
    expect((await api('get', '/dequeue/jobs').expect(200)).body).toEqual({ id: 1 });
    await api('delete', '/purge/jobs').expect(200);
    expect(await queue.size('jobs')).toBe(0);
  });

  it('rejects enqueue without a task', async () => {
    await api('post', '/enqueue/jobs').send({}).expect(400);
  });

  it('routes named-instance requests to that instance', async () => {
    await api('post', '/other/enqueue/q').send({ task: 'a' }).expect(200);
    expect(await other.size('q')).toBe(1);
    expect(await queue.size('q')).toBe(0);
    expect((await api('get', '/other/size/q').expect(200)).body).toBe(1);
    expect((await api('get', '/other/queues').expect(200)).body).toContain('q');
    expect((await api('get', '/other/dequeue/q').expect(200)).body).toBe('a');
    await api('delete', '/other/purge/q').expect(200);
    await api('get', '/other/analytics').expect(200);
  });

  it('hides provider failures', async () => {
    for (const method of ['enqueue', 'dequeue', 'size', 'listQueues', 'purge']) {
      jest.spyOn(queue, method).mockRejectedValue(new Error('broker secret'));
    }
    const res = await api('post', '/enqueue/jobs').send({ task: 1 }).expect(500);
    expect(JSON.stringify(res.body)).not.toContain('broker secret');
    await api('get', '/dequeue/jobs').expect(500);
    await api('get', '/size/jobs').expect(500);
    await api('get', '/queues').expect(500);
    await api('delete', '/purge/jobs').expect(500);
  });

  it('lists instances', async () => {
    expect((await api('get', '/instances').expect(200)).body.instances.map((i) => i.name)).toEqual(['default', 'other']);
  });

  it('returns analytics, or 503 when unavailable', async () => {
    await queue.enqueue('a', 1);
    expect((await api('get', '/analytics').expect(200)).body).toEqual(expect.any(Object));
    const saved = queue.analytics;
    queue.analytics = null;
    await api('get', '/analytics').expect(503);
    queue.analytics = saved;
  });

  it('gets and saves settings, and hides failures', async () => {
    await api('get', '/settings').expect(200);
    await api('post', '/settings').send({}).expect(200);
    jest.spyOn(queue, 'getSettings').mockRejectedValue(new Error('x'));
    jest.spyOn(queue, 'saveSettings').mockRejectedValue(new Error('x'));
    await api('get', '/settings').expect(500);
    await api('post', '/settings').send({}).expect(500);
  });

  it('serves the client script and swagger docs', async () => {
    const script = await t.request('get', '/services/queueing/scripts').expect(200);
    expect(script.headers['content-type']).toMatch(/javascript/);
    await api('get', '/swagger/docs.json').expect(200);
  });
});
