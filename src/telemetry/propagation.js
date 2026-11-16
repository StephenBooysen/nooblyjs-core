'use strict';

/**
 * @fileoverview Trace context across queues (feature 07).
 *
 * The producer side is automatic: when a span is active, `queueing.enqueue`
 * adds a W3C carrier, `_trace: { traceparent }`, to a plain-object item. The
 * consumer side calls {@link continueTrace} with the item it received, so its
 * work becomes a child of the producer's span, across processes. Without
 * OpenTelemetry installed, nothing is added and {@link continueTrace} just runs
 * the function.
 *
 * @module telemetry/propagation
 */

/** Key of the carrier added to queued items. */
const CARRIER_KEY = '_trace';

/** Set by Telemetry.start() when tracing is active, cleared on shutdown. */
let active = null;

/**
 * Registers the OpenTelemetry API and tracer for propagation. Called by Telemetry.
 * @param {{api: Object, tracer: Object}|null} state
 */
function setActivePropagation(state) {
  active = state;
}

/**
 * Carrier for the current span, or null when there is no active span.
 * @return {?{traceparent: string}}
 */
function currentCarrier() {
  if (!active) return null;
  const carrier = {};
  active.api.propagation.inject(active.api.context.active(), carrier);
  return carrier.traceparent ? { traceparent: carrier.traceparent } : null;
}

/**
 * Runs `fn` in a span whose parent is the producer's span carried on `item`.
 * Returns `fn`'s result. Without tracing, or without a carrier, runs `fn` alone.
 *
 * @template T
 * @param {*} item A queued item, possibly carrying `_trace`
 * @param {string} spanName Name of the consumer span, for example "webhook deliver"
 * @param {function(): (T|Promise<T>)} fn
 * @return {Promise<T>}
 *
 * @example
 * const work = await continueTrace(job.data, 'orders.process', () => handle(job.data));
 */
async function continueTrace(item, spanName, fn) {
  const carrier = item && typeof item === 'object' && !Array.isArray(item) ? item[CARRIER_KEY] : null;
  if (!active || !carrier || typeof carrier.traceparent !== 'string') return fn();
  const { api, tracer } = active;
  const parent = api.propagation.extract(api.ROOT_CONTEXT, { traceparent: carrier.traceparent });
  return tracer.startActiveSpan(spanName, {}, parent, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.setAttribute('error.type', error && error.name ? error.name : 'Error');
      span.setStatus({ code: api.SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

module.exports = { CARRIER_KEY, setActivePropagation, currentCarrier, continueTrace };
