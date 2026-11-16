'use strict';

/**
 * @fileoverview Optional OpenTelemetry tracing (feature 07).
 *
 * Turned on with `telemetry: { enabled: true }` in the registry options. The
 * `@opentelemetry/*` packages are optional peers and are loaded only then. When
 * they are not installed, telemetry logs a warning and the app keeps request
 * ids in its logs, so nothing breaks.
 *
 * Spans carry route patterns and status codes, never request bodies, query
 * strings, headers, tokens or keys. Service calls record the service, provider
 * and instance, and the error type, but not error messages or arguments.
 *
 * @module telemetry
 */

const { setSpanIdsProvider } = require('./requestContext');
const { CARRIER_KEY, setActivePropagation, currentCarrier, continueTrace } = require('./propagation');
const { createServiceMetrics } = require('./metrics');

/** Whether the process-wide OpenTelemetry context manager has been installed. */
let contextManagerInstalled = false;

/** Marks an instance whose async methods are already wrapped. */
const INSTRUMENTED = Symbol.for('nooblyjs.telemetry.instrumented');

/** Services never wrapped, to avoid tracing the tracer or every log line. */
const DEFAULT_EXCLUDED = ['logging', 'telemetry'];

/**
 * Loads an optional module, or returns null when it is not installed.
 *
 * @param {string} name Package name
 * @return {?Object} The module, or null
 */
function optionalRequire(name) {
  try {
    return require(name);
  } catch (_error) {
    return null;
  }
}

/**
 * Whether an async function (a method that returns a promise) is defined on
 * the instance or its prototype chain.
 *
 * @param {Function} fn Candidate
 * @return {boolean}
 */
function isAsyncFunction(fn) {
  return typeof fn === 'function' && fn.constructor && fn.constructor.name === 'AsyncFunction';
}

/**
 * Adds GenAI semantic-convention attributes from a model call's result:
 * the model, and input and output token counts when the result reports them.
 *
 * @param {Object} span The active span
 * @param {string} providerType Model provider name, for gen_ai.system
 * @param {*} result The method's return value
 */
function recordGenAi(span, providerType, result) {
  if (!result || typeof result !== 'object') return;
  span.setAttribute('gen_ai.system', String(providerType));
  if (typeof result.model === 'string') span.setAttribute('gen_ai.response.model', result.model);
  const usage = result.usage && typeof result.usage === 'object' ? result.usage : {};
  if (typeof usage.input_tokens === 'number') span.setAttribute('gen_ai.usage.input_tokens', usage.input_tokens);
  if (typeof usage.output_tokens === 'number') span.setAttribute('gen_ai.usage.output_tokens', usage.output_tokens);
}

/**
 * Tracing controller. The registry creates one and calls start() during
 * initialize(). It is a no-op until the SDK loads.
 */
class Telemetry {
  /**
   * @param {Object} [options]
   * @param {boolean=} options.enabled Turn tracing on (default false)
   * @param {string=} options.serviceName Service name in the resource (default OTEL_SERVICE_NAME or 'nooblyjs-app')
   * @param {'console'|'otlp'|'memory'|'none'=} options.exporter Where spans go (default 'console' when enabled; 'memory' keeps them in process for tests)
   * @param {string=} options.endpoint OTLP endpoint (default OTEL_EXPORTER_OTLP_ENDPOINT)
   * @param {number=} options.sampleRatio Share of new traces recorded, 0 to 1 (default 1)
   * @param {boolean=} options.instrumentServices Wrap service methods in spans (default true)
   * @param {string[]=} options.excludeServices Services never wrapped (default logging and telemetry)
   * @param {Object=} eventEmitter Shared emitter, for telemetry:status
   */
  constructor(options = {}, eventEmitter = null) {
    this.options_ = options || {};
    this.eventEmitter_ = eventEmitter;
    this.active = false;
    this.api_ = null;
    this.provider_ = null;
    this.tracer_ = null;
    this.status_ = { enabled: false, active: false, reason: 'disabled' };
    this.instrumentServices_ = this.options_.instrumentServices !== false;
    this.excluded_ = new Set([...DEFAULT_EXCLUDED, ...(this.options_.excludeServices || [])]);
  }

  /**
   * Loads the SDK and starts the tracer provider. Safe to call when telemetry
   * is off, or when the packages are missing.
   *
   * @return {{enabled: boolean, active: boolean, reason: string}} Current status
   */
  start() {
    if (!this.options_.enabled) return this.setStatus_({ enabled: false, active: false, reason: 'disabled' });
    if (process.env.OTEL_SDK_DISABLED === 'true') {
      return this.setStatus_({ enabled: true, active: false, reason: 'OTEL_SDK_DISABLED=true' });
    }

    const api = optionalRequire('@opentelemetry/api');
    const sdk = optionalRequire('@opentelemetry/sdk-trace-node');
    const base = optionalRequire('@opentelemetry/sdk-trace-base');
    if (!api || !sdk || !base) {
      return this.setStatus_({
        enabled: true,
        active: false,
        reason: 'OpenTelemetry packages are not installed; install @opentelemetry/api and @opentelemetry/sdk-trace-node'
      });
    }

    const exporterName = this.options_.exporter || 'console';
    const processors = [];
    if (exporterName === 'console') {
      processors.push(new base.SimpleSpanProcessor(new base.ConsoleSpanExporter()));
    } else if (exporterName === 'memory') {
      // In-process exporter, for tests and local inspection.
      this.memory_ = new base.InMemorySpanExporter();
      processors.push(new base.SimpleSpanProcessor(this.memory_));
    } else if (exporterName === 'otlp') {
      const otlp = optionalRequire('@opentelemetry/exporter-trace-otlp-http');
      if (otlp) {
        const endpoint = this.options_.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        processors.push(new base.BatchSpanProcessor(new otlp.OTLPTraceExporter(endpoint ? { url: `${endpoint.replace(/\/$/, '')}/v1/traces` } : {})));
      }
    }

    const ratio = typeof this.options_.sampleRatio === 'number' ? this.options_.sampleRatio : 1;
    const sampler = new base.ParentBasedSampler({ root: new base.TraceIdRatioBasedSampler(Math.min(1, Math.max(0, ratio))) });
    const resources = optionalRequire('@opentelemetry/resources');
    const serviceName = this.options_.serviceName || process.env.OTEL_SERVICE_NAME || 'nooblyjs-app';

    this.provider_ = new sdk.NodeTracerProvider({
      sampler,
      spanProcessors: processors,
      ...(resources ? { resource: resources.resourceFromAttributes({ 'service.name': serviceName }) } : {})
    });
    // The context manager is process-wide, so install it once. Each instance
    // takes its tracer from its own provider, so its spans reach its exporter.
    if (!contextManagerInstalled) {
      this.provider_.register();
      contextManagerInstalled = true;
    }

    this.api_ = api;
    this.tracer_ = this.provider_.getTracer('nooblyjs-core');
    setActivePropagation({ api, tracer: this.tracer_ });
    this.metrics_ = null;
    if (this.options_.metrics) {
      const sdkMetrics = optionalRequire('@opentelemetry/sdk-metrics');
      if (sdkMetrics) {
        const metricsExporter = this.options_.metricsExporter
          || (exporterName === 'otlp' ? 'otlp' : exporterName === 'memory' ? 'memory' : 'console');
        this.metrics_ = createServiceMetrics(sdkMetrics, {
          exporter: metricsExporter,
          endpoint: this.options_.endpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
          otlp: optionalRequire('@opentelemetry/exporter-metrics-otlp-http'),
          intervalMs: this.options_.metricsIntervalMs
        });
      }
    }
    setSpanIdsProvider(() => {
      const span = api.trace.getActiveSpan();
      if (!span) return null;
      const context = span.spanContext();
      return { traceId: context.traceId, spanId: context.spanId };
    });
    this.active = true;

    return this.setStatus_({
      enabled: true,
      active: true,
      metrics: Boolean(this.metrics_),
      reason: processors.length === 0 ? 'no exporter: spans are recorded but not sent' : `exporter: ${exporterName}`
    });
  }

  /**
   * Express middleware: one server span per request, named by route pattern
   * once the request has been routed. Accepts and returns W3C traceparent.
   *
   * @return {function(import('express').Request, import('express').Response, import('express').NextFunction): void}
   */
  middleware() {
    const { api_: api, tracer_: tracer } = this;
    return (req, res, next) => {
      if (!this.active) return next();
      const parent = api.propagation.extract(api.context.active(), req.headers);
      const span = tracer.startSpan(req.method, {
        kind: api.SpanKind.SERVER,
        attributes: { 'http.request.method': req.method }
      }, parent);

      const spanContext = span.spanContext();
      res.setHeader('traceparent', `00-${spanContext.traceId}-${spanContext.spanId}-01`);

      res.on('finish', () => {
        const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : null;
        span.updateName(`${req.method} ${route || 'unmatched'}`);
        span.setAttribute('http.response.status_code', res.statusCode);
        if (route) span.setAttribute('http.route', route);
        if (req.user && req.user.id) span.setAttribute('enduser.id', String(req.user.id));
        if (res.statusCode >= 500) span.setStatus({ code: api.SpanStatusCode.ERROR });
        span.end();
      });

      api.context.with(api.trace.setSpan(parent, span), () => next());
    };
  }

  /**
   * Wraps the async methods of a service instance in spans named
   * `service.method`. Sync methods and getters are left alone.
   *
   * @param {Object} instance Service instance
   * @param {string} serviceName Service name, for example 'caching'
   * @param {string} providerType Provider, for example 'memory'
   * @param {string} instanceName Named instance, for example 'default'
   * @return {void}
   */
  instrument(instance, serviceName, providerType, instanceName) {
    const self = this;
    if (!this.active || !this.instrumentServices_ || !instance || typeof instance !== 'object') return;
    if (this.excluded_.has(serviceName) || instance[INSTRUMENTED]) return;

    const { api_: api, tracer_: tracer } = this;
    const attributes = {
      'nooblyjs.service': serviceName,
      'nooblyjs.provider': providerType,
      'nooblyjs.instance': instanceName
    };
    const seen = new Set();
    for (let proto = instance; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (name === 'constructor' || name.startsWith('_') || name.endsWith('_')) continue;
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (!descriptor || typeof descriptor.value !== 'function' || !isAsyncFunction(descriptor.value)) continue;

        const method = descriptor.value;
        const spanName = `${serviceName}.${name}`;
        // Queue producers pass their trace context on the item (feature 07).
        const propagates = serviceName === 'queueing' && name === 'enqueue';
        instance[name] = function instrumented(...args) {
          const started = Date.now();
          return tracer.startActiveSpan(spanName, { attributes }, async (span) => {
            let failed = false;
            try {
              let callArgs = args;
              if (propagates && args[1] && typeof args[1] === 'object' && !Array.isArray(args[1]) && !args[1][CARRIER_KEY]) {
                const carrier = currentCarrier();
                if (carrier) callArgs = [args[0], { ...args[1], [CARRIER_KEY]: carrier }, ...args.slice(2)];
              }
              const result = await method.apply(this, callArgs);
              if (serviceName === 'aiservice') recordGenAi(span, providerType, result);
              return result;
            } catch (error) {
              failed = true;
              // The error type only: messages can carry input data.
              span.setAttribute('error.type', error && error.name ? error.name : 'Error');
              span.setStatus({ code: api.SpanStatusCode.ERROR });
              throw error;
            } finally {
              span.end();
              self.metrics_?.record(serviceName, name, Date.now() - started, failed);
            }
          });
        };
      }
    }
    Object.defineProperty(instance, INSTRUMENTED, { value: true, enumerable: false });
  }

  /**
   * Flushes spans and stops the provider. Called by the registry on shutdown.
   *
   * @return {Promise<void>}
   */
  async shutdown() {
    setSpanIdsProvider(null);
    setActivePropagation(null);
    this.active = false;
    if (this.metrics_) {
      await this.metrics_.shutdown().catch(() => {});
      this.metrics_ = null;
    }
    if (this.provider_) {
      await this.provider_.shutdown().catch(() => {});
      this.provider_ = null;
    }
  }

  /**
   * Records and announces the status.
   *
   * @param {{enabled: boolean, active: boolean, reason: string}} status
   * @return {{enabled: boolean, active: boolean, reason: string}}
   * @private
   */
  setStatus_(status) {
    this.status_ = status;
    this.eventEmitter_?.emit?.('telemetry:status', status);
    return status;
  }

  /**
   * Runs a queue consumer's work as a child of the producer's span (feature 07).
   * Use it on the item a consumer received. Without tracing, it just runs `fn`.
   *
   * @template T
   * @param {*} item The queued item (carries `_trace` when the producer was traced)
   * @param {string} spanName Name for the consumer span
   * @param {function(): (T|Promise<T>)} fn The consumer's work
   * @return {Promise<T>}
   *
   * @example
   * const { telemetry } = registry;
   * await telemetry.continueTrace(job.data, 'orders.process', () => handle(job.data));
   */
  continueTrace(item, spanName, fn) {
    return continueTrace(item, spanName, fn);
  }

  /**
   * Spans finished so far, when the exporter is 'memory'. Empty otherwise.
   *
   * @return {Array<Object>}
   */
  finishedSpans() {
    return this.memory_ ? this.memory_.getFinishedSpans() : [];
  }

  /**
   * Current status, for the services dashboard and health checks.
   *
   * @return {{enabled: boolean, active: boolean, reason: string}}
   */
  status() {
    return { ...this.status_ };
  }
}

module.exports = { Telemetry, INSTRUMENTED };
