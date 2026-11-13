/**
 * @fileoverview A client session against the MCP endpoint through the registry
 * (feature 03): the status card's endpoint, initialize, tool listing, a read
 * tool call, and write tools staying hidden unless allowed.
 */
'use strict';

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const registry = require('../../../index');

const KEY = 'mcp-session-test-key';

function start(mcp) {
  const app = express();
  app.use(express.json());
  registry.initialize(app, new EventEmitter(), {
    apiKeys: [KEY],
    requireApiKey: true,
    security: { servicesAuth: { requireLogin: false } },
    mcp
  });
  return app;
}

describe('MCP session and status (feature 03)', () => {
  afterEach(async () => {
    await registry.shutdown?.();
    registry.reset?.();
  });

  it('reports the endpoint and read tools, with write tools off', async () => {
    const app = start({ enabled: true, allowWrite: false });
    const res = await request(app).get('/services/api/mcp/status').expect(200);
    expect(res.body.data).toEqual({ enabled: true, endpoint: '/services/mcp', readTools: 9, writeTools: 0, writeEnabled: false });
  });

  it('reports the status as off when MCP is not enabled', async () => {
    const app = start({});
    const res = await request(app).get('/services/api/mcp/status').expect(200);
    expect(res.body.data).toEqual(expect.objectContaining({ enabled: false, endpoint: null, readTools: 0 }));
  });

  it('runs initialize, lists tools and calls a read tool', async () => {
    const app = start({ enabled: true, allowWrite: false });
    const call = (body) => request(app).post('/services/mcp').set('x-api-key', KEY).send(body);

    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } }).expect(200);
    expect(init.body.result.protocolVersion).toBe('2025-06-18');

    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).expect(200);
    const names = list.body.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['logs.recent', 'monitoring.snapshot']));
    expect(names).not.toContain('queue.purge');

    const read = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'logs.recent', arguments: { limit: 5 } } }).expect(200);
    expect(read.body.result.isError).not.toBe(true);
  });

  it('lists write tools only when allowWrite is set, and still needs an API key', async () => {
    const app = start({ enabled: true, allowWrite: true });
    const list = await request(app).post('/services/mcp').set('x-api-key', KEY).send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(200);
    expect(list.body.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['queue.purge']));
    await request(app).post('/services/mcp').send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).expect((r) => {
      if (r.status < 400) throw new Error(`expected a refusal, got ${r.status}`);
    });
  });
});
