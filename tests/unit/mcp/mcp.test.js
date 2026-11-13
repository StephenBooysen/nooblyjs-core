/**
 * @fileoverview MCP server for the registry (feature 03): transport, tool
 * registration, permissions, input checks, result caps and audit events.
 */
'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');
const registry = require('../../../index');
const { createMcpServer, schemaProblem, capResult } = require('../../../src/mcp');
const { testDataDir } = require('../../helpers/testData');

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

/** Builds a server with a stub queue, a fake caller and a recording emitter. */
function stubServer({ roles = null, scopes, allowWrite = false } = {}) {
  const queue = {
    size: jest.fn(async () => 3),
    jobCounts: jest.fn(async () => ({ waiting: 1 })),
    supportsReliableJobs: true,
    enqueue: jest.fn(async () => 'id'),
    purge: jest.fn(async () => {})
  };
  const emitter = new EventEmitter();
  const emitSpy = jest.spyOn(emitter, 'emit');
  const server = createMcpServer({
    services: {
      logger: () => ({ analytics: { list: () => [{ level: 'error', message: 'boom' }] } }),
      queue: () => queue,
      dataService: () => ({}),
      searching: () => ({}),
      workflow: () => ({}),
      scheduling: () => ({}),
      cache: () => ({}),
      settings: () => ({}),
      monitoring: () => ({}),
      describe: () => ({ services: ['queueing'] })
    },
    openApi: () => ({ openapi: '3.1.0' }),
    allowWrite,
    resolvePrincipal: async () => (roles ? { principal: 'pat@example.com', roles } : { principal: 'key:x', scopes }),
    eventEmitter: emitter
  });
  return { server, queue, emitSpy };
}

describe('MCP server (feature 03)', () => {
  describe('protocol', () => {
    it('answers initialize with the protocol version and tool capability', async () => {
      const { server } = stubServer({ scopes: null });
      const reply = await server.handle(rpc('initialize', {}), {});
      expect(reply.result.protocolVersion).toBe('2025-06-18');
      expect(reply.result.capabilities.tools).toBeDefined();
      expect(reply.result.serverInfo.name).toBe('nooblyjs-core');
    });

    it('returns null for notifications and an error for unknown methods', async () => {
      const { server } = stubServer({ scopes: null });
      expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, {})).toBeNull();
      const reply = await server.handle(rpc('nope/nope', {}), {});
      expect(reply.error.code).toBe(-32601);
    });

    it('rejects messages that are not JSON-RPC 2.0', async () => {
      const { server } = stubServer({ scopes: null });
      const reply = await server.handle({ method: 'tools/list', id: 2 }, {});
      expect(reply.error.code).toBe(-32600);
    });

    it('refuses tool calls from a caller with no identity', async () => {
      const anonymous = createMcpServer({
        services: { describe: () => ({}) },
        openApi: () => ({}),
        resolvePrincipal: async () => null
      });
      const reply = await anonymous.handle(rpc('tools/list', {}), {});
      expect(reply.error.code).toBe(-32600);
    });
  });

  describe('tools', () => {
    it('lists read tools only, unless writes are allowed', async () => {
      const readOnly = stubServer({ scopes: null }).server;
      const names = (await readOnly.handle(rpc('tools/list', {}), {})).result.tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['logs.recent', 'queue.stats', 'workflow.getRun']));
      expect(names).not.toContain('queue.enqueue');
      expect(names).not.toContain('settings.set');

      const writable = stubServer({ scopes: null, allowWrite: true }).server;
      const all = (await writable.handle(rpc('tools/list', {}), {})).result.tools;
      expect(all.map((t) => t.name)).toEqual(expect.arrayContaining(['queue.enqueue', 'queue.purge', 'workflow.run']));
      expect(all.find((t) => t.name === 'queue.enqueue').annotations.readOnlyHint).toBe(false);
      expect(all.find((t) => t.name === 'queue.stats').annotations.readOnlyHint).toBe(true);
    });

    it('calls a read tool and returns its result as structured content', async () => {
      const { server } = stubServer({ scopes: null });
      const reply = await server.handle(rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'emails' } }), {});
      expect(reply.result.isError).toBe(false);
      expect(reply.result.structuredContent).toEqual({ queue: 'emails', size: 3, jobs: { waiting: 1 } });
    });

    it('rejects input that does not match the tool schema, before the tool runs', async () => {
      const { server, queue } = stubServer({ scopes: null });
      const missing = await server.handle(rpc('tools/call', { name: 'queue.stats', arguments: {} }), {});
      expect(missing.error.code).toBe(-32602);
      expect(missing.error.message).toMatch(/queue is required/);

      const extra = await server.handle(rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'a', drop: 1 } }), {});
      expect(extra.error.message).toMatch(/not an allowed field/);
      expect(queue.size).not.toHaveBeenCalled();
    });

    it('does not run a write tool unless writes are allowed', async () => {
      const { server, queue } = stubServer({ scopes: null, allowWrite: false });
      const reply = await server.handle(rpc('tools/call', { name: 'queue.purge', arguments: { queue: 'a' } }), {});
      expect(reply.error.code).toBe(-32602);
      expect(queue.purge).not.toHaveBeenCalled();
    });

    it('runs a write tool for the admin wildcard when writes are allowed', async () => {
      const { server, queue } = stubServer({ scopes: null, allowWrite: true });
      const reply = await server.handle(rpc('tools/call', { name: 'queue.enqueue', arguments: { queue: 'a', item: { n: 1 } } }), {});
      expect(reply.result.isError).toBe(false);
      expect(queue.enqueue).toHaveBeenCalledWith('a', { n: 1 });
    });

    it('denies a write tool to an editor, who lacks the wildcard, and records the denial', async () => {
      const { server, queue, emitSpy } = stubServer({ roles: ['editor'], allowWrite: true });
      const reply = await server.handle(rpc('tools/call', { name: 'queue.purge', arguments: { queue: 'a' } }), {});
      expect(reply.result.isError).toBe(true);
      expect(reply.result.content[0].text).toMatch(/Forbidden/);
      expect(queue.purge).not.toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith('mcp:tool:called', expect.objectContaining({ tool: 'queue.purge', outcome: 'denied' }));
    });

    it('applies the service permission to a read tool (a plain user cannot read queues)', async () => {
      const user = stubServer({ roles: ['user'] }).server;
      const denied = await user.handle(rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'a' } }), {});
      expect(denied.result.isError).toBe(true);

      const editor = stubServer({ roles: ['editor'] }).server;
      const allowed = await editor.handle(rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'a' } }), {});
      expect(allowed.result.isError).toBe(false);
    });

    it('respects a token narrowed to fewer scopes than its owner', async () => {
      const narrowed = createMcpServer({
        services: { queue: () => ({ size: async () => 1 }), describe: () => ({}) },
        openApi: () => ({}),
        resolvePrincipal: async () => ({ principal: 'pat', roles: ['editor'], tokenScopes: ['logging:read'] })
      });
      const reply = await narrowed.handle(rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'a' } }), {});
      expect(reply.result.isError).toBe(true);
    });

    it('emits an audit event for every call, with the outcome', async () => {
      const { server, emitSpy } = stubServer({ scopes: null });
      await server.handle(rpc('tools/call', { name: 'logs.recent', arguments: {} }), {});
      expect(emitSpy).toHaveBeenCalledWith('mcp:tool:called', { principal: 'key:x', tool: 'logs.recent', outcome: 'ok' });
    });

    it('reports a tool failure as a tool error without leaking internal messages', async () => {
      const server = createMcpServer({
        services: { queue: () => ({ size: async () => { throw new Error('secret connection string'); } }), describe: () => ({}) },
        openApi: () => ({}),
        resolvePrincipal: async () => ({ principal: 'k', scopes: null })
      });
      const reply = await server.handle(rpc('tools/call', { name: 'queue.stats', arguments: { queue: 'a' } }), {});
      expect(reply.result.isError).toBe(true);
      expect(reply.result.content[0].text).not.toMatch(/secret/);
    });
  });

  describe('resources and prompts', () => {
    it('reads the services and OpenAPI resources, and refuses unknown ones', async () => {
      const { server } = stubServer({ scopes: null });
      const services = await server.handle(rpc('resources/read', { uri: 'nooblyjs://services' }), {});
      expect(JSON.parse(services.result.contents[0].text)).toEqual({ services: ['queueing'] });
      const openapi = await server.handle(rpc('resources/read', { uri: 'nooblyjs://openapi' }), {});
      expect(JSON.parse(openapi.result.contents[0].text).openapi).toBe('3.1.0');
      const unknown = await server.handle(rpc('resources/read', { uri: 'nooblyjs://secrets' }), {});
      expect(unknown.error.code).toBe(-32602);
    });

    it('returns the diagnose prompt with the execution id filled in', async () => {
      const { server } = stubServer({ scopes: null });
      const reply = await server.handle(rpc('prompts/get', { name: 'diagnose-failed-run', arguments: { executionId: 'run-42' } }), {});
      expect(reply.result.messages[0].content.text).toMatch(/run-42/);
    });
  });

  describe('helpers', () => {
    it('checks types, enums, nested objects and arrays', () => {
      expect(schemaProblem({ n: 'x' }, { type: 'object', properties: { n: { type: 'integer' } } })).toMatch(/n must be integer/);
      expect(schemaProblem({ level: 'trace' }, { type: 'object', properties: { level: { enum: ['info'] } } })).toMatch(/one of info/);
      expect(schemaProblem({ items: [1, 'two'] }, { type: 'object', properties: { items: { type: 'array', items: { type: 'integer' } } } })).toMatch(/items\[1\]/);
      expect(schemaProblem({ n: 3 }, { type: 'object', properties: { n: { type: 'integer' } } })).toBeNull();
    });

    it('caps long lists and large results', () => {
      const long = Array.from({ length: 500 }, (_, i) => i);
      expect(capResult(long)).toEqual({ value: long.slice(0, 200), truncated: true });
      const big = 'x'.repeat(300 * 1024);
      expect(capResult(big).truncated).toBe(true);
      expect(capResult({ a: 1 })).toEqual({ value: { a: 1 }, truncated: false });
    });
  });

  describe('endpoint in the registry', () => {
    let app;
    beforeAll(() => {
      const dir = testDataDir('mcp');
      app = express();
      app.use(express.json());
      registry.initialize(app, new EventEmitter(), {
        apiKeys: ['k'],
        mcp: { enabled: true },
        security: { servicesAuth: { requireLogin: false } }
      });
      registry.logger('memory'); registry.queue('memory');
      registry.settings('file', { filepath: path.join(dir, 'settings.json'), secret: 'x'.repeat(32) });
    });
    afterAll(async () => { await registry.shutdown?.(); registry.reset?.(); });

    it('answers initialize and tools/list over HTTP for an API key', async () => {
      const init = await request(app).post('/services/mcp').set('x-api-key', 'k').send(rpc('initialize', {})).expect(200);
      expect(init.body.result.protocolVersion).toBe('2025-06-18');
      const tools = await request(app).post('/services/mcp').set('x-api-key', 'k').send(rpc('tools/list', {})).expect(200);
      expect(tools.body.result.tools.map((t) => t.name)).toContain('queue.stats');
    });

    it('answers 202 to a notification and 405 to a GET', async () => {
      await request(app).post('/services/mcp').set('x-api-key', 'k').send({ jsonrpc: '2.0', method: 'notifications/initialized' }).expect(202);
      await request(app).get('/services/mcp').set('x-api-key', 'k').expect(405);
    });

    it('handles a batch and returns one reply per request', async () => {
      const res = await request(app).post('/services/mcp').set('x-api-key', 'k')
        .send([rpc('ping', {}, 1), rpc('ping', {}, 2), { jsonrpc: '2.0', method: 'notifications/cancelled' }])
        .expect(200);
      expect(res.body.map((r) => r.id)).toEqual([1, 2]);
    });

    it('refuses a request with no identity', async () => {
      const res = await request(app).post('/services/mcp').send(rpc('tools/list', {})).expect(200);
      expect(res.body.error).toBeDefined();
    });
  });
});
