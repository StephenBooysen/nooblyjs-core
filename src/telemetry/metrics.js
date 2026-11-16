'use strict';

/**
 * @fileoverview Service-call metrics for OpenTelemetry (feature 07).
 *
 * Records one histogram (`nooblyjs.service.duration`, milliseconds) and one
 * counter (`nooblyjs.service.errors`) per service method, with the attributes
 * `nooblyjs.service` and `nooblyjs.method`. Needs the optional
 * `@opentelemetry/sdk-metrics` package. Without it, {@link createServiceMetrics}
 * is not called and nothing is recorded.
 *
 * @module telemetry/metrics
 */

/**
 * Builds the meter provider, reader and instruments.
 *
 * @param {Object} sdk The `@opentelemetry/sdk-metrics` module
 * @param {Object=} options
 * @param {string=} options.exporter 'otlp' | 'memory' | 'console' (default 'console')
 * @param {string=} options.endpoint OTLP base URL; `/v1/metrics` is appended
 * @param {Object=} options.otlp The `@opentelemetry/exporter-metrics-otlp-http` module
 * @param {number=} options.intervalMs How often metrics are exported (default 60000)
 * @return {{record: function(string, string, number, boolean): void, flush: function(): Promise<void>, shutdown: function(): Promise<void>, exporter: Object}}
 */
function createServiceMetrics(sdk, options = {}) {
  const { exporter = 'console', endpoint, otlp, intervalMs = 60000 } = options;

  let exportImpl;
  if (exporter === 'memory') {
    exportImpl = new sdk.InMemoryMetricExporter(sdk.AggregationTemporality.CUMULATIVE);
  } else if (exporter === 'otlp' && otlp) {
    exportImpl = new otlp.OTLPMetricExporter(endpoint ? { url: `${endpoint.replace(/\/$/, '')}/v1/metrics` } : {});
  } else {
    exportImpl = new sdk.ConsoleMetricExporter();
  }

  const reader = new sdk.PeriodicExportingMetricReader({ exporter: exportImpl, exportIntervalMillis: intervalMs });
  const provider = new sdk.MeterProvider({ readers: [reader] });
  const meter = provider.getMeter('nooblyjs-core');
  const duration = meter.createHistogram('nooblyjs.service.duration', {
    unit: 'ms',
    description: 'Duration of service method calls'
  });
  const errors = meter.createCounter('nooblyjs.service.errors', {
    description: 'Service method calls that threw'
  });

  return {
    /**
     * Records one call.
     * @param {string} service Service name
     * @param {string} method Method name
     * @param {number} durationMs Elapsed time
     * @param {boolean} failed Whether the call threw
     */
    record(service, method, durationMs, failed) {
      const attributes = { 'nooblyjs.service': service, 'nooblyjs.method': method };
      duration.record(durationMs, attributes);
      if (failed) errors.add(1, attributes);
    },
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
    exporter: exportImpl
  };
}

module.exports = { createServiceMetrics };
