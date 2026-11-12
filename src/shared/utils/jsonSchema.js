/**
 * @fileoverview A small JSON Schema validator with no dependencies.
 *
 * Covers the subset NooblyJS uses for AI structured output (feature 02) and
 * provider option schemas (feature 08): `type` (one or a list), `enum`,
 * `const`, `properties`, `required`, `additionalProperties` (boolean or
 * schema), `items`, `minItems`/`maxItems`, `minLength`/`maxLength`,
 * `pattern`, `minimum`/`maximum`, `anyOf`, and `default` (read by callers).
 * Unknown keywords are ignored.
 *
 * @module shared/utils/jsonSchema
 */

'use strict';

/**
 * JSON type name of a value.
 * @param {*} value - Any value
 * @return {string}
 */
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/**
 * Whether a value matches a JSON type name (`integer` counts as `number`).
 * @param {*} value - Value
 * @param {string} type - JSON Schema type
 * @return {boolean}
 */
function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  if (type === 'any') return true;
  return actual === type;
}

/**
 * Validates a value against a schema.
 *
 * @param {!Object} schema - JSON Schema (subset)
 * @param {*} value - Value to check
 * @param {string=} at - Path prefix for messages
 * @return {!Array<{path: string, message: string}>} Problems; empty when valid
 * @example
 * validateSchema({ type: 'object', required: ['name'] }, {}); // [{ path: '$', message: 'missing required "name"' }]
 */
function validateSchema(schema, value, at = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;
  const add = (message, path = at) => errors.push({ path, message });

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      add(`expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    add(`must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    add(`must be ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((s) => validateSchema(s, value, at).length === 0)) {
    add('matches none of the allowed shapes');
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) add(`shorter than ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) add(`longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) add(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) add(`less than ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) add(`more than ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) add(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(schema.items, item, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (value[key] === undefined) add(`missing required "${key}"`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) {
        if (child !== undefined) errors.push(...validateSchema(props[key], child, `${at}.${key}`));
      } else if (schema.additionalProperties === false) {
        add(`unknown property "${key}"`, `${at}.${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validateSchema(schema.additionalProperties, child, `${at}.${key}`));
      }
    }
  }
  return errors;
}

/**
 * Edit distance between two strings (for "did you mean" hints).
 * @param {string} a - First
 * @param {string} b - Second
 * @return {number}
 */
function editDistance(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[y.length];
}

/**
 * The closest candidate to a misspelt key, or null if nothing is close.
 * @param {string} key - What was given
 * @param {!Array<string>} candidates - Valid keys
 * @return {?string}
 */
function closestKey(key, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = editDistance(key, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best !== null && bestScore <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
}

module.exports = { validateSchema, typeOf, editDistance, closestKey };
