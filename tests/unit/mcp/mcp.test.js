/**
 * @fileoverview MCP server (feature 03): protocol methods, tool discovery,
 * the write gate, argument checks, redaction, audit events, auth and the
 * resources and prompts. Boots the registry with MCP enabled.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('events');

const serviceRegistry = require('../../../index');
const { testDataDir } = require('../../helpers/testData');
const { validateArguments } = require('../../../src/mcp/schema');
const { redact, toContent, MAX_RESULT_CHARS } = require('../../../src/mcp/output');

const ADMIN_KEY = 'mcp-admin-key-0123456789abcdef0123456789ab';
const SCOPED_KEY = 'mcp-scoped-key-0123456789abcdef0123456789ab';

/** Boots the registry with MCP on and a few services instantiated. */
function boot(workDir, { allowWrite = false } = {}) {
  serviceRegistry.reset();
  const app = express();
  app.use(express.json());
  const events = new EventEmitter();
  serviceRegistry.initialize(app, events, {
    logDir: path.join(workDir, 'logs'),
    dataDir: path.join(workDir, 'data'),
    mcp: { enabled: true, allowWrite },
    security: {
      apiKeyAuth: {
        apiKeys: [ADMIN_KEY, { key: SCOPED_KEY, name: 'mcp-scoped', scopes: ['cache:read'] }],
        requireApiKey: true,
        excludePaths: ['/services/*/status']
      },
      servicesAuth: { requireLogin: false }
    }
  });
  const log = serviceRegistry.logger('memory');
  serviceRegistry.cache('memory');
  serviceRegistry.queue('memory');
  serviceRegistry.dataService('memory');
  serviceRegistry.searching('memory');
  serviceRegistry.scheduling('memory');
  return { app, events, log };
}

/** Sends one JSON-RPC message with the admin key. */
function rpc(app, body, key = ADMIN_KEY) {
  return request(app).post('/services/api/mcp').set('x-api-key', key).send(body);
}

let nextId = 1;
/** Builds a request message. */
const call = (method, params) => ({ jsonrpc: '2.0', id: nextId++, method, params });

describe('MCP server (feature 03)', () => {
  let workDir;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(testDataDir('mcp'), 'mcp-'));
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  afterEach(() => {
    serviceRegistry.reset();
  });

  describe('protocol', () => {
    it('answers initialize with the negotiated version and server info', async () => {
      const { app } = boot(workDir);
      const res = await rpc(app, call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).expect(200);
      expect(res.body.result.protocolVersion).toBe('2025-06-18');
      expect(res.body.result.serverInfo).toEqual(expect.objectContaining({ name: 'nooblyjs-core' }));
      expect(res.body.result.capabilities.tools).toBeDefined();
    });

    it('falls back to the server’s own version when the client asks for one it does not speak', async () => {
      const { app } = boot(workDir);
      const res = await rpc(app, call('initialize', { protocolVersion: '1999-01-01' })).expect(200);
      expect(res.body.result.protocolVersion).toBe('2025-06-18');
    });

    it('accepts notifications with 202 and no body', async () => {
      const { app } = boot(workDir);
      await rpc(app, { jsonrpc: '2.0', method: 'notifications/initialized' }).expect(202);
    });

    it('answers an unknown method with -32601 and a malformed message with -32600', async () => {
      const { app } = boot(workDir);
      const unknown = await rpc(app, call('nope/nope')).expect(200);
      expect(unknown.body.error.code).toBe(-32601);
      const malformed = await rpc(app, { id: 5, method: 'ping' }).expect(200);
      expect(malformed.body.error.code).toBe(-32600);
    });

    it('refuses GET, because the server does not open a stream', async () => {
      const { app } = boot(workDir);
      const res = await request(app).get('/services/api/mcp').set('x-api-key', ADMIN_KEY).expect(405);
      expect(res.headers.allow).toBe('POST');
    });

    it('needs a key: an anonymous caller is refused', async () => {
      const { app } = boot(workDir);
      const res = await request(app).post('/services/api/mcp').send(call('ping'));
      expect([401, 403]).toContain(res.status);
    });

    it('refuses a key without the mcp:use permission', async () => {
      const { app } = boot(workDir);
      await rpc(app, call('ping'), SCOPED_KEY).expect(403);
    });

    it('answers a batch with one reply per request', async () => {
      const { app } = boot(workDir);
      const res = await rpc(app, [call('ping'), call('tools/list', {})]).expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].result).toEqual({});
    });
  });

  describe('tools', () => {
    it('lists read tools from every instantiated service, prefixed by service', async () => {
      const { app } = boot(workDir);
      const res = await rpc(app, call('tools/list', {})).expect(200);
      const names = res.body.result.tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['logging_recent', 'queueing_list', 'dataservice_find', 'searching_query', 'caching_stats', 'platform_snapshot']));
      expect(names).not.toContain('queueing_purge');
    });

    it('hides write tools unless mcp.allowWrite is set, and refuses calling them', async () => {
      const { app } = boot(workDir, { allowWrite: false });
      const listed = await rpc(app, call('tools/list', {})).expect(200);
      expect(listed.body.result.tools.map((t) => t.name)).not.toContain('queueing_enqueue');

      const called = await rpc(app, call('tools/call', { name: 'queueing_enqueue', arguments: { queueName: 'q', item: {} } })).expect(200);
      expect(called.body.error.code).toBe(-32602);
    });

    it('shows and runs write tools for an administrator key when allowed', async () => {
      const { app } = boot(workDir, { allowWrite: true });
      const listed = await rpc(app, call('tools/list', {})).expect(200);
      expect(listed.body.result.tools.map((t) => t.name)).toContain('queueing_enqueue');

      const done = await rpc(app, call('tools/call', { name: 'queueing_enqueue', arguments: { queueName: 'mcp-q', item: { n: 1 } } })).expect(200);
      expect(done.body.result.isError).toBe(false);
      const size = await rpc(app, call('tools/call', { name: 'queueing_size', arguments: { queueName: 'mcp-q' } })).expect(200);
      expect(size.body.result.content[0].text).toContain('"size": 1');
    });

    it('rejects arguments that break the schema, with the reason', async () => {
      const { app } = boot(workDir);
      const res = await rpc(app, call('tools/call', { name: 'logging_recent', arguments: { level: 'shout' } })).expect(200);
      expect(res.body.error.code).toBe(-32602);
      expect(res.body.error.message).toContain('level must be one of');

      const missing = await rpc(app, call('tools/call', { name: 'queueing_size', arguments: {} })).expect(200);
      expect(missing.body.error.message).toContain('queueName is required');
    });

    it('returns recent log entries from the logging service', async () => {
      const { app, log } = boot(workDir);
      await log.info('mcp test entry', { source: 'test' });
      const res = await rpc(app, call('tools/call', { name: 'logging_recent', arguments: { limit: 200 } })).expect(200);
      expect(res.body.result.isError).toBe(false);
      expect(res.body.result.content[0].text).toContain('mcp test entry');
    });

    it('redacts secret-looking keys in results', async () => {
      const { app } = boot(workDir);
      await rpc(app, call('tools/call', { name: 'queueing_list', arguments: {} })).expect(200);
      const data = serviceRegistry.dataService('memory');
      await data.createContainer('people');
      await data.add('people', { name: 'Ann', password: 'hunter2', apiKey: 'abc' });
      const res = await rpc(app, call('tools/call', { name: 'dataservice_find', arguments: { containerName: 'people' } })).expect(200);
      const text = res.body.result.content[0].text;
      expect(text).toContain('Ann');
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('"abc"');
      expect(text).toContain('[redacted]');
    });

    it('audits a failing call and never returns the internal error text', async () => {
      const { app, events } = boot(workDir);
      const emit = jest.spyOn(events, 'emit');
      // Make the logging tool fail with an internal message.
      const logging = serviceRegistry.getServiceInstance('logging', 'memory', 'default');
      logging.analytics = { list: () => { throw new Error('ENOENT /srv/private/x'); } };
      const res = await rpc(app, call('tools/call', { name: 'logging_recent', arguments: {} })).expect(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).not.toContain('/srv/private');
      expect(emit).toHaveBeenCalledWith('mcp:tool:called', expect.objectContaining({ tool: 'logging_recent', outcome: 'error' }));
    });

    it('audits every successful call with the tool, outcome and actor', async () => {
      const { app, events } = boot(workDir);
      const emit = jest.spyOn(events, 'emit');
      await rpc(app, call('tools/call', { name: 'queueing_list', arguments: {} })).expect(200);
      expect(emit).toHaveBeenCalledWith('mcp:tool:called', expect.objectContaining({
        tool: 'queueing_list',
        outcome: 'ok',
        write: false,
        actor: expect.stringContaining('api key')
      }));
    });
  });

  describe('resources and prompts', () => {
    it('lists and reads the services and OpenAPI resources', async () => {
      const { app } = boot(workDir);
      const list = await rpc(app, call('resources/list', {})).expect(200);
      expect(list.body.result.resources.map((r) => r.uri)).toEqual(expect.arrayContaining(['nooblyjs://services', 'nooblyjs://openapi']));

      const services = await rpc(app, call('resources/read', { uri: 'nooblyjs://services' })).expect(200);
      expect(services.body.result.contents[0].text).toContain('queueing');

      const openapi = await rpc(app, call('resources/read', { uri: 'nooblyjs://openapi' })).expect(200);
      expect(JSON.parse(openapi.body.result.contents[0].text).openapi).toBe('3.1.0');
    });

    it('gives a diagnosis prompt and refuses a prompt without its argument', async () => {
      const { app } = boot(workDir);
      const ok = await rpc(app, call('prompts/get', { name: 'diagnose-failed-run', arguments: { workflowName: 'import' } })).expect(200);
      expect(ok.body.result.messages[0].content.text).toContain('"import"');

      const missing = await rpc(app, call('prompts/get', { name: 'diagnose-failed-run', arguments: {} })).expect(200);
      expect(missing.body.error.message).toContain('workflowName is required');
    });
  });
});

describe('MCP helpers', () => {
  it('validates the supported schema subset', () => {
    const schema = {
      type: 'object',
      required: ['n'],
      properties: { n: { type: 'integer', minimum: 1, maximum: 5 }, tags: { type: 'array', items: { type: 'string', maxLength: 3 } } }
    };
    expect(validateArguments(schema, { n: 2, tags: ['ab'] })).toBeNull();
    expect(validateArguments(schema, { n: 2.5 })).toContain('integer');
    expect(validateArguments(schema, { n: 9 })).toContain('at most 5');
    expect(validateArguments(schema, { n: 1, tags: ['toolong'] })).toContain('at most 3');
    expect(validateArguments(schema, [])).toContain('must be an object');
  });

  it('turns an internal error into a generic message, not its text', async () => {
    const { createServer } = require('../../../src/mcp/server');
    const services = new Map([['logging:memory:default', { analytics: { list: () => { throw new Error('db password is hunter2'); } } }]]);
    const server = createServer({ services, serverInfo: { name: 'x', version: '1' }, allowWrite: false, canWrite: false, roles: [], actor: 't' });
    const result = await server.callTool('logging_recent', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('hunter2');
    expect(result.content[0].text).toContain('The tool failed');
  });

  it('masks secrets at any depth and caps large results', () => {
    expect(redact({ a: { Authorization: 'Bearer x' }, list: [{ clientSecret: 's' }] }))
      .toEqual({ a: { Authorization: '[redacted]' }, list: [{ clientSecret: '[redacted]' }] });
    const big = toContent('x'.repeat(MAX_RESULT_CHARS + 10));
    expect(big.text).toContain('truncated');
  });
});
