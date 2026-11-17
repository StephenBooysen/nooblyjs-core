'use strict';

/**
 * @fileoverview Trace context across queues, service metrics and GenAI
 * attributes (feature 07). The OpenTelemetry cases run only when the SDK is
 * installed; the no-carrier case always runs.
 */

const { EventEmitter } = require('node:events');
const { Telemetry } = require('../../../src/telemetry');
const { continueTrace } = require('../../../src/telemetry/propagation');

const hasOtelSdk = (() => {
  try {
    require.resolve('@opentelemetry/sdk-trace-node');
    require.resolve('@opentelemetry/sdk-metrics');
    return true;
  } catch (_error) {
    return false;
  }
})();
const describeOtel = hasOtelSdk ? describe : describe.skip;

describe('continueTrace without tracing', () => {
  it('runs the function and returns its result when there is no carrier', async () => {
    await expect(continueTrace({ plain: true }, 'consume', () => 'done')).resolves.toBe('done');
    await expect(continueTrace(null, 'consume', async () => 7)).resolves.toBe(7);
  });
});

describeOtel('trace context and metrics (feature 07)', () => {
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

  it('carries the producer span to the consumer across a queue', async () => {
    const telemetry = start();
    class Queue {
      constructor() { this.items = []; }
      async enqueue(name, item) { this.items.push(item); return 'queued'; }
    }
    const queue = new Queue();
    telemetry.instrument(queue, 'queueing', 'memory', 'default');

    await queue.enqueue('webhooks', { deliveryId: 'del_1' });
    const [queued] = queue.items;
    expect(queued._trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);

    await continueTrace(queued, 'webhook deliver', async () => 'delivered');

    const spans = telemetry.finishedSpans();
    const producer = spans.find((s) => s.name === 'queueing.enqueue');
    const consumer = spans.find((s) => s.name === 'webhook deliver');
    expect(producer && consumer).toBeTruthy();
    expect(consumer.spanContext().traceId).toBe(producer.spanContext().traceId);
    expect(consumer.parentSpanContext?.spanId ?? consumer.parentSpanId).toBe(producer.spanContext().spanId);
  });

  it('leaves non-object queue items untouched', async () => {
    const telemetry = start();
    class Queue { async enqueue(name, item) { return item; } }
    const queue = new Queue();
    telemetry.instrument(queue, 'queueing', 'memory', 'default');
    await expect(queue.enqueue('q', 'plain text')).resolves.toBe('plain text');
  });

  it('marks the consumer span as failed when its work throws, with the error type only', async () => {
    const telemetry = start();
    await expect(continueTrace({ _trace: { traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01' } }, 'consume', async () => {
      throw new TypeError('secret input');
    })).rejects.toThrow('secret input');
    const span = telemetry.finishedSpans().find((s) => s.name === 'consume');
    expect(span.attributes['error.type']).toBe('TypeError');
    expect(JSON.stringify(span.attributes)).not.toContain('secret input');
  });

  it('records service call duration and errors as metrics', async () => {
    const telemetry = start({ metrics: true, metricsExporter: 'memory' });
    expect(telemetry.status().metrics).toBe(true);
    class Cache {
      async get(key) { if (key === 'bad') throw new Error('nope'); return key; }
    }
    const cache = new Cache();
    telemetry.instrument(cache, 'caching', 'memory', 'default');
    await cache.get('ok');
    await cache.get('bad').catch(() => {});

    await telemetry.metrics_.flush();
    const names = telemetry.metrics_.exporter.getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)));
    expect(names).toEqual(expect.arrayContaining(['nooblyjs.service.duration', 'nooblyjs.service.errors']));
  });

  it('keeps metrics off unless asked for', () => {
    const telemetry = start();
    expect(telemetry.status().metrics).toBe(false);
    expect(telemetry.metrics_).toBeNull();
  });

  it('adds GenAI attributes from an AI call result', async () => {
    const telemetry = start();
    class AIService {
      async chat() { return { model: 'claude-test', usage: { input_tokens: 12, output_tokens: 7 }, text: 'hi' }; }
    }
    const ai = new AIService();
    telemetry.instrument(ai, 'aiservice', 'anthropic', 'default');
    await ai.chat();
    const span = telemetry.finishedSpans().find((s) => s.name === 'aiservice.chat');
    expect(span.attributes).toMatchObject({
      'gen_ai.system': 'anthropic',
      'gen_ai.response.model': 'claude-test',
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 7
    });
  });
});
