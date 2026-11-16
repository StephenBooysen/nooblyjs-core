'use strict';

const express = require('express');
const request = require('supertest');
const { EventEmitter } = require('node:events');
const serviceRegistry = require('../../../index');

/** Whether the optional OpenTelemetry SDK is installed. SDK tests are skipped without it. */
const hasOtelSdk = (() => {
  try {
    require.resolve('@opentelemetry/sdk-trace-node');
    return true;
  } catch (_error) {
    return false;
  }
})();
const itOtel = hasOtelSdk ? it : it.skip;

describe('registry telemetry (feature 07)', () => {
  let emitter;

  beforeEach(() => {
    serviceRegistry.reset();
    emitter = new EventEmitter();
  });

  afterEach(async () => {
    await serviceRegistry.shutdown().catch(() => {});
    serviceRegistry.reset();
  });

  it('starts with request ids in logs and no spans when telemetry is off', async () => {
    const app = express();
    serviceRegistry.initialize(app, emitter, {});
    expect(serviceRegistry.telemetryStatus).toMatchObject({ enabled: false, active: false });

    const lines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)));
    const log = serviceRegistry.logger('memory');
    app.get('/work', async (req, res) => {
      await log.info('handling work');
      res.json({});
    });
    try {
      const res = await request(app).get('/work').set('x-request-id', 'job-7').expect(200);
      expect(res.headers['x-request-id']).toBe('job-7');
    } finally {
      spy.mockRestore();
    }
    expect(lines.some((l) => l.includes('request_id=job-7') && l.includes('handling work'))).toBe(true);
  });

  itOtel('records a span for each async service call when telemetry is on', async () => {
    const app = express();
    serviceRegistry.initialize(app, emitter, {
      telemetry: { enabled: true, exporter: 'memory', serviceName: 'test-app' }
    });
    expect(serviceRegistry.telemetryStatus).toMatchObject({ enabled: true, active: true });

    const cache = serviceRegistry.cache('memory');
    await cache.put('answer', 42);
    expect(await cache.get('answer')).toBe(42);

    const names = serviceRegistry.telemetry.finishedSpans().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['caching.put', 'caching.get']));
  });

  itOtel('leaves the logging service unwrapped even when telemetry is on', async () => {
    serviceRegistry.initialize(express(), emitter, {
      telemetry: { enabled: true, exporter: 'memory' }
    });
    const log = serviceRegistry.logger('memory');
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await log.info('quiet');
    } finally {
      spy.mockRestore();
    }
    const names = serviceRegistry.telemetry.finishedSpans().map((s) => s.name);
    expect(names.some((n) => n.startsWith('logging.'))).toBe(false);
  });
});
