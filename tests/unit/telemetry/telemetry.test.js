'use strict';

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('node:events');
const {
  createRequestContextMiddleware,
  correlationFields,
  parseTraceparent,
  runWithRequestContext
} = require('../../../src/telemetry/requestContext');
const { Telemetry } = require('../../../src/telemetry');

/** Whether the optional OpenTelemetry SDK is installed. SDK tests are skipped without it. */
const hasOtelSdk = (() => {
  try {
    require.resolve('@opentelemetry/sdk-trace-node');
    return true;
  } catch (_error) {
    return false;
  }
})();
const describeOtel = hasOtelSdk ? describe : describe.skip;
const itOtel = hasOtelSdk ? it : it.skip;

describe('request context (feature 07)', () => {
  const appWith = (handler) => {
    const app = express();
    app.use(createRequestContextMiddleware());
    app.get('/ctx', handler);
    return app;
  };

  it('makes a request id when none is sent, and echoes it', async () => {
    const seen = [];
    const res = await request(appWith((req, out) => {
      seen.push(correlationFields());
      out.json({ ok: true });
    })).get('/ctx').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0]).toEqual({ request_id: res.headers['x-request-id'] });
  });

  it('keeps a well-formed incoming request id', async () => {
    const res = await request(appWith((req, out) => out.json({})))
      .get('/ctx').set('x-request-id', 'order-42.retry_1').expect(200);
    expect(res.headers['x-request-id']).toBe('order-42.retry_1');
  });

  it('replaces a request id that could inject into logs', async () => {
    const res = await request(appWith((req, out) => out.json({})))
      .get('/ctx').set('x-request-id', 'ok [FAKE] forged').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('has no fields outside a request', () => {
    expect(correlationFields()).toEqual({});
  });

  it('carries the context across async work inside a request', async () => {
    const values = await runWithRequestContext({ requestId: 'r-1', traceId: null }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return correlationFields();
    });
    expect(values).toEqual({ request_id: 'r-1' });
  });

  it('parses a valid traceparent and rejects malformed or all-zero ones', () => {
    const valid = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    expect(parseTraceparent(valid)).toEqual({
      traceId: '0af7651916cd43dd8448eb211c80319c',
      parentSpanId: 'b7ad6b7169203331'
    });
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01')).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
  });
});

describeOtel('telemetry (feature 07)', () => {
  const instances = [];

  afterEach(async () => {
    for (const telemetry of instances.splice(0)) await telemetry.shutdown();
  });

  const start = (options = {}) => {
    const telemetry = new Telemetry({ enabled: true, exporter: 'memory', ...options }, new EventEmitter());
    instances.push(telemetry);
    telemetry.start();
    return telemetry;
  };

  it('stays off by default', () => {
    const telemetry = new Telemetry({}, null);
    expect(telemetry.start()).toMatchObject({ enabled: false, active: false, reason: 'disabled' });
    expect(telemetry.active).toBe(false);
  });

  it('stays off when OTEL_SDK_DISABLED is set', () => {
    const previous = process.env.OTEL_SDK_DISABLED;
    process.env.OTEL_SDK_DISABLED = 'true';
    try {
      const telemetry = new Telemetry({ enabled: true, exporter: 'memory' }, null);
      expect(telemetry.start()).toMatchObject({ enabled: true, active: false });
    } finally {
      if (previous === undefined) delete process.env.OTEL_SDK_DISABLED; else process.env.OTEL_SDK_DISABLED = previous;
    }
  });

  it('starts, reports the exporter, and reports a missing SDK as a reason rather than an error', () => {
    const telemetry = start();
    expect(telemetry.status()).toMatchObject({ enabled: true, active: true, reason: 'exporter: memory' });
  });

  it('records one server span per request, named by route, with the status, and returns traceparent', async () => {
    const telemetry = start();
    const app = express();
    app.use(telemetry.middleware());
    app.get('/items/:id', (req, res) => res.status(201).json({ id: req.params.id }));

    const res = await request(app).get('/items/42?token=secret').set('authorization', 'Bearer dtk_secret').expect(201);
    expect(res.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const spans = telemetry.finishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('GET /items/:id');
    expect(spans[0].attributes['http.response.status_code']).toBe(201);
    expect(spans[0].attributes['http.route']).toBe('/items/:id');
    expect(JSON.stringify(spans[0].attributes)).not.toMatch(/secret|dtk_|42/);
  });

  it('continues an incoming trace and marks server errors', async () => {
    const telemetry = start();
    const app = express();
    app.use(telemetry.middleware());
    app.get('/boom', (req, res) => res.status(500).json({}));

    const incoming = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    await request(app).get('/boom').set('traceparent', incoming).expect(500);

    const [span] = telemetry.finishedSpans();
    expect(span.spanContext().traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(span.parentSpanContext.spanId).toBe('b7ad6b7169203331');
    expect(span.status.code).toBe(2);
  });

  it('wraps async service methods in spans, and leaves sync methods and private methods alone', async () => {
    const telemetry = start();
    class Cache {
      async get(key) { return `value:${key}`; }
      set(key) { return key; }
      async _internal() { return 'hidden'; }
    }
    const cache = new Cache();
    telemetry.instrument(cache, 'caching', 'memory', 'default');

    expect(await cache.get('a')).toBe('value:a');
    expect(cache.set('b')).toBe('b');
    expect(await cache._internal()).toBe('hidden');

    const spans = telemetry.finishedSpans();
    expect(spans.map((s) => s.name)).toEqual(['caching.get']);
    expect(spans[0].attributes).toMatchObject({
      'nooblyjs.service': 'caching',
      'nooblyjs.provider': 'memory',
      'nooblyjs.instance': 'default'
    });
  });

  it('records the error type on a failing service call, but not the message', async () => {
    const telemetry = start();
    class Store {
      async read() {
        const error = new TypeError('secret-value-in-message');
        throw error;
      }
    }
    const store = new Store();
    telemetry.instrument(store, 'dataservice', 'file', 'default');
    await expect(store.read()).rejects.toThrow('secret-value-in-message');

    const [span] = telemetry.finishedSpans();
    expect(span.attributes['error.type']).toBe('TypeError');
    expect(JSON.stringify(span.attributes)).not.toContain('secret-value-in-message');
    expect(JSON.stringify(span.events)).not.toContain('secret-value-in-message');
    expect(span.status.message).toBeUndefined();
  });

  it('does not wrap excluded services, and does not wrap twice', () => {
    const telemetry = start();
    class Logger { async info() { return 'x'; } }
    const logger = new Logger();
    telemetry.instrument(logger, 'logging', 'memory', 'default');
    expect(logger.info.name).toBe('info');

    class Cache { async get() { return 1; } }
    const cache = new Cache();
    telemetry.instrument(cache, 'caching', 'memory', 'default');
    const once = cache.get;
    telemetry.instrument(cache, 'caching', 'memory', 'default');
    expect(cache.get).toBe(once);
  });

  it('adds the span ids to log correlation while a span is active', async () => {
    const telemetry = start();
    const app = express();
    app.use(createRequestContextMiddleware());
    app.use(telemetry.middleware());
    let fields = null;
    app.get('/x', (req, res) => {
      fields = correlationFields();
      res.json({});
    });
    await request(app).get('/x').expect(200);
    expect(fields.request_id).toBeTruthy();
    expect(fields.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(fields.span_id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('telemetry without the OpenTelemetry packages', () => {
  it('reports the packages as missing and keeps the request id in logs', async () => {
    jest.resetModules();
    jest.doMock('@opentelemetry/api', () => { throw new Error("Cannot find module '@opentelemetry/api'"); }, { virtual: true });
    const { Telemetry: Isolated } = require('../../../src/telemetry');
    const { createRequestContextMiddleware: middleware, correlationFields: fields } = require('../../../src/telemetry/requestContext');

    const telemetry = new Isolated({ enabled: true }, null);
    expect(telemetry.start()).toMatchObject({ enabled: true, active: false });
    expect(telemetry.status().reason).toMatch(/not installed/);

    const app = express();
    app.use(middleware());
    app.use(telemetry.middleware());
    let seen = null;
    app.get('/x', (req, res) => { seen = fields(); res.json({}); });
    await request(app).get('/x').expect(200);
    expect(seen.request_id).toBeTruthy();
    expect(seen.trace_id).toBeUndefined();
    jest.dontMock('@opentelemetry/api');
  });
});
