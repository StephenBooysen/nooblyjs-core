/**
 * @fileoverview Request validation and pagination caps for route boundaries (P2-7).
 *
 * Deliberately small and dependency-free: a declarative field schema checked
 * by `validate()` middleware, plus `parseLimit`/`parseOffset` to clamp paging
 * parameters. Violations produce a 400 with a client-safe message.
 *
 * Field rule properties:
 *   type       'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
 *   required   boolean
 *   minLength / maxLength   (strings, arrays)
 *   min / max               (numbers)
 *   pattern    RegExp       (strings)
 *   enum       Array        allowed values
 *
 * @author NooblyJS Team
 * @since 1.1.0
 */

'use strict';

const { ClientError } = require('./httpErrors');

/** Largest page size any list endpoint returns unless it sets its own. */
const DEFAULT_MAX_LIMIT = 1000;

/**
 * Parses and clamps a `limit` query value.
 *
 * @param {*} value - Raw value (usually a query string)
 * @param {Object} [options] - Options
 * @param {number} [options.defaultValue=100] - Used when missing or invalid
 * @param {number} [options.max=1000] - Upper bound
 * @return {number} Integer between 1 and max
 *
 * @example
 * const limit = parseLimit(req.query.limit, { defaultValue: 50, max: 500 });
 */
function parseLimit(value, { defaultValue = 100, max = DEFAULT_MAX_LIMIT } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return Math.min(defaultValue, max);
  return Math.min(n, max);
}

/**
 * Caps an already-parsed limit while preserving "not supplied" (NaN), for
 * endpoints where a missing limit means "use the analytics default".
 *
 * @param {number} n - Parsed value (may be NaN)
 * @param {number} [max=1000] - Upper bound
 * @return {number} NaN, or an integer between 1 and max
 */
function capLimit(n, max = DEFAULT_MAX_LIMIT) {
  if (Number.isNaN(n)) return n;
  return Math.min(Math.max(n, 1), max);
}

/**
 * Parses an `offset`/`page`-style query value as a non-negative integer.
 *
 * @param {*} value - Raw value
 * @param {Object} [options] - Options
 * @param {number} [options.defaultValue=0] - Used when missing or invalid
 * @param {number} [options.min=0] - Lower bound (use 1 for page numbers)
 * @param {number} [options.max=1e6] - Upper bound
 * @return {number} Clamped integer
 */
function parseOffset(value, { defaultValue = 0, min = 0, max = 1e6 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min) return defaultValue;
  return Math.min(n, max);
}

/**
 * Returns the JSON-ish type name of a value.
 *
 * @param {*} value - Any value
 * @return {string} Type name
 */
function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/**
 * Checks one value against a field rule.
 *
 * @param {string} where - 'body' | 'query' | 'params'
 * @param {string} field - Field name
 * @param {*} value - Value to check
 * @param {Object} rule - Field rule
 * @return {?string} Error message, or null when valid
 */
function checkField(where, field, value, rule) {
  const label = `${where}.${field}`;
  if (value === undefined || value === null || value === '') {
    return rule.required ? `${label} is required` : null;
  }

  let v = value;
  // Query/params arrive as strings; coerce for numeric/boolean rules.
  if (where !== 'body' && typeof v === 'string') {
    if (rule.type === 'number' || rule.type === 'integer') v = Number(v);
    if (rule.type === 'boolean') v = v === 'true' ? true : (v === 'false' ? false : v);
  }

  if (rule.type) {
    const actual = typeOf(v);
    const ok = rule.type === 'integer'
      ? Number.isInteger(v)
      : (rule.type === 'number' ? actual === 'number' && Number.isFinite(v) : actual === rule.type);
    if (!ok) return `${label} must be ${rule.type === 'integer' ? 'an integer' : `a ${rule.type}`}`;
  }
  if (rule.enum && !rule.enum.includes(v)) return `${label} must be one of: ${rule.enum.join(', ')}`;
  if ((typeof v === 'string' || Array.isArray(v)) && rule.minLength !== undefined && v.length < rule.minLength) {
    return `${label} must have at least ${rule.minLength} ${typeof v === 'string' ? 'characters' : 'items'}`;
  }
  if ((typeof v === 'string' || Array.isArray(v)) && rule.maxLength !== undefined && v.length > rule.maxLength) {
    return `${label} must have at most ${rule.maxLength} ${typeof v === 'string' ? 'characters' : 'items'}`;
  }
  if (typeof v === 'number' && rule.min !== undefined && v < rule.min) return `${label} must be >= ${rule.min}`;
  if (typeof v === 'number' && rule.max !== undefined && v > rule.max) return `${label} must be <= ${rule.max}`;
  if (typeof v === 'string' && rule.pattern && !rule.pattern.test(v)) return `${label} has an invalid format`;
  return null;
}

/**
 * Validates request parts against a schema, throwing a 400 ClientError.
 *
 * @param {Object} req - Express request (or any object with body/query/params)
 * @param {{body?: Object, query?: Object, params?: Object}} schema - Field rules per part
 * @return {void}
 * @throws {ClientError} 400 listing every violation
 */
function assertValid(req, schema) {
  const errors = [];
  for (const where of ['params', 'query', 'body']) {
    const rules = schema[where];
    if (!rules) continue;
    const source = req[where] || {};
    if (where === 'body' && typeOf(source) !== 'object') {
      errors.push('body must be a JSON object');
      continue;
    }
    for (const [field, rule] of Object.entries(rules)) {
      const message = checkField(where, field, source[field], rule);
      if (message) errors.push(message);
    }
  }
  if (errors.length) {
    throw new ClientError(400, `Invalid request: ${errors.join('; ')}`, { details: errors });
  }
}

/**
 * Express middleware that validates the request and responds 400 on failure.
 *
 * @param {{body?: Object, query?: Object, params?: Object}} schema - Field rules
 * @return {function(Object, Object, Function): void} Middleware
 *
 * @example
 * app.post('/services/authservice/api/login',
 *   validate({ body: { email: { type: 'string', required: true, maxLength: 254 } } }),
 *   handler);
 */
function validate(schema) {
  const middleware = (req, res, next) => {
    try {
      assertValid(req, schema);
      return next();
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: err.message,
        details: err.details || []
      });
    }
  };
  // The OpenAPI generator reads the rules to describe parameters and bodies.
  middleware.schema = schema;
  return middleware;
}

module.exports = { DEFAULT_MAX_LIMIT, parseLimit, capLimit, parseOffset, assertValid, validate };
