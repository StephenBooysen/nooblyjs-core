'use strict';

/**
 * @fileoverview Request context for log correlation (feature 07).
 *
 * Holds the request id, the W3C trace id and the caller's user id for the
 * life of one HTTP request, using AsyncLocalStorage, so every log line written
 * while the request is in flight can say which request it belongs to. This
 * works with no OpenTelemetry package installed. When the OpenTelemetry SDK is
 * active, the span ids come from the active span.
 *
 * @module telemetry/requestContext
 */

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/** Accepted request ids: letters, digits, dots, dashes, underscores; 1 to 128 characters. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** W3C traceparent: version 00, non-zero trace id and parent id. */
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/** Returns the span ids of the active OpenTelemetry span, when the SDK provided a hook. */
let spanIdsProvider = null;

/**
 * Registers a function that returns `{ traceId, spanId }` for the active span.
 * The telemetry module calls this when the OpenTelemetry API is loaded.
 *
 * @param {?function(): ?{traceId: string, spanId: string}} provider
 * @return {void}
 */
function setSpanIdsProvider(provider) {
  spanIdsProvider = typeof provider === 'function' ? provider : null;
}

/**
 * Reads the context of the current request, if there is one.
 *
 * @return {?{requestId: string, traceId: ?string, userId: ?string}}
 */
function getRequestContext() {
  return storage.getStore() || null;
}

/**
 * Runs a function inside a request context.
 *
 * @param {Object} context Context to make current
 * @param {Function} fn Function to run
 * @return {*} Whatever fn returns
 */
function runWithRequestContext(context, fn) {
  return storage.run(context, fn);
}

/**
 * Parses a W3C traceparent header.
 *
 * @param {*} header Raw header value
 * @return {?{traceId: string, parentSpanId: string}} Parsed ids, or null when invalid
 */
function parseTraceparent(header) {
  if (typeof header !== 'string') return null;
  const match = TRACEPARENT_PATTERN.exec(header.trim());
  if (!match) return null;
  const [, traceId, parentSpanId] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null;
  return { traceId, parentSpanId };
}

/**
 * Fields to add to a log line for the current request.
 *
 * @return {Object<string, string>} Empty when there is no request context
 */
function correlationFields() {
  const context = getRequestContext();
  if (!context) return {};
  const fields = { request_id: context.requestId };
  const spanIds = spanIdsProvider ? spanIdsProvider() : null;
  if (spanIds) {
    fields.trace_id = spanIds.traceId;
    fields.span_id = spanIds.spanId;
  } else if (context.traceId) {
    fields.trace_id = context.traceId;
  }
  return fields;
}

/**
 * Creates the middleware that opens a request context. It takes the caller's
 * X-Request-Id when it is well formed, otherwise makes one, and echoes it in
 * the response. It also keeps the W3C trace id from traceparent.
 *
 * @return {function(import('express').Request, import('express').Response, import('express').NextFunction): void}
 */
function createRequestContextMiddleware() {
  return function requestContext(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : crypto.randomUUID();
    const parsed = parseTraceparent(req.headers.traceparent);

    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);

    const context = {
      requestId,
      traceId: parsed ? parsed.traceId : null,
      userId: null
    };
    // Lets the auth middleware record who the caller is, without the token.
    req.requestContext = context;
    storage.run(context, () => next());
  };
}

module.exports = {
  createRequestContextMiddleware,
  correlationFields,
  getRequestContext,
  parseTraceparent,
  runWithRequestContext,
  setSpanIdsProvider
};
