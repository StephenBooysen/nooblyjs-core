/**
 * @fileoverview Argument checking for MCP tools (feature 03). A small subset of
 * JSON Schema: type, required, properties, items, enum, minimum, maximum,
 * minLength and maxLength. Anything a tool declares beyond that is ignored, so
 * a tool should keep its schema to this subset.
 *
 * @module mcp/schema
 */

'use strict';

/**
 * Checks a value against a schema.
 * @param {*} value
 * @param {!Object} schema
 * @param {string=} at Path of the value, for messages
 * @return {?string} The first problem found, or null when the value is valid
 */
function checkValue(value, schema, at = 'arguments') {
  if (!schema || typeof schema !== 'object') return null;
  const type = schema.type;
  if (type) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const ok = type === 'integer'
      ? Number.isInteger(value)
      : type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : type === actual;
    if (!ok) return `${at} must be ${type === 'integer' ? 'an integer' : `a ${type}`}`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${at} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${at} must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${at} must be at most ${schema.maximum}`;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${at} must be at least ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${at} must be at most ${schema.maxLength} characters`;
  }
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i += 1) {
      const problem = checkValue(value[i], schema.items, `${at}[${i}]`);
      if (problem) return problem;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) return `${at}.${key} is required`;
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] === undefined) continue;
      const problem = checkValue(value[key], sub, `${at}.${key}`);
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * Checks tool arguments against the tool's input schema.
 * @param {!Object} inputSchema
 * @param {*} args
 * @return {?string} The problem, or null
 */
function validateArguments(inputSchema, args) {
  const value = args === undefined ? {} : args;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'arguments must be an object';
  return checkValue(value, inputSchema, 'arguments');
}

module.exports = { validateArguments, checkValue };
