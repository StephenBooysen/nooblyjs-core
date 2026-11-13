/**
 * @fileoverview Checks the options a caller passes to a service before the
 * factory runs (feature 08).
 *
 * Schemas are plain objects, one per service and provider. A typo in an option
 * name is reported with the closest valid name, a wrong type or a missing
 * required option is an error, and a canonical alias is mapped onto the name
 * the provider reads. Only options the caller passed are checked, not the
 * registry's global options, so shared settings cannot cause false warnings.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

/** Keys every service accepts, because the registry or the framework adds them. */
const COMMON_KEYS = new Set([
  'instanceName', 'dependencies', 'ServiceRegistry', 'providerType', 'express-app',
  'eventEmitter', 'logDir', 'dataDir', 'enableLogging', 'description', 'list', 'analytics'
]);

/** Warnings already shown, so each key is reported once per process. */
const warnedKeys = new Set();

/**
 * Levenshtein distance between two strings, case-insensitive.
 * @param {string} a First string
 * @param {string} b Second string
 * @return {number} Edit distance
 */
function editDistance(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= y.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[y.length];
}

/**
 * Returns the valid key closest to an unknown one, if it is close enough.
 * @param {string} name Unknown option name
 * @param {Array<string>} valid Valid option names
 * @return {?string} Suggestion, or null
 */
function suggest(name, valid) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of valid) {
    const d = editDistance(name, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best && bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

/**
 * Checks one value against a declared type.
 * @param {*} value Value to check
 * @param {string} type 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function' | 'any'
 * @return {boolean} Whether the value matches
 */
function matchesType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'function': return typeof value === 'function';
    default: return true;
  }
}

/**
 * Validates the options for one service and provider.
 *
 * Schema shape, per service and provider:
 * `{ required: ['name'], keys: { name: { type: 'string' }, legacy: { type: 'string', legacyOf: 'canonical' }, canonical: { type: 'string', maps: 'legacy' } } }`
 *
 * @param {string} serviceName Service name, for example `caching`
 * @param {string} providerType Provider name, for example `redis`
 * @param {Object} options Options the caller passed
 * @param {Object} schemas Schemas keyed by service then provider
 * @return {{errors: Array<string>, warnings: Array<string>, options: Object}} Findings and the options to use
 */
function validateServiceOptions(serviceName, providerType, options, schemas) {
  const errors = [];
  const warnings = [];
  const normalized = { ...options };
  const schema = schemas?.[serviceName]?.[providerType];
  if (!schema) {
    return { errors, warnings, options: normalized };
  }

  const where = `${serviceName}/${providerType}`;
  const keys = schema.keys || {};
  const validKeys = Object.keys(keys);

  for (const name of schema.required || []) {
    if (options[name] === undefined || options[name] === null || options[name] === '') {
      errors.push(`${where}: missing required option "${name}"`);
    }
  }

  for (const [name, value] of Object.entries(options)) {
    if (value === undefined) continue;
    const spec = keys[name];
    if (!spec) {
      if (COMMON_KEYS.has(name)) continue;
      const hint = suggest(name, validKeys);
      warnings.push(`${where}: unknown option "${name}"${hint ? `, did you mean "${hint}"?` : ''}`);
      continue;
    }
    if (!matchesType(value, spec.type)) {
      errors.push(`${where}: option "${name}" must be a ${spec.type}`);
      continue;
    }
    if (spec.legacyOf && !warnedKeys.has(`${where}:${name}`)) {
      warnedKeys.add(`${where}:${name}`);
      warnings.push(`${where}: option "${name}" is a legacy spelling; use "${spec.legacyOf}"`);
    }
    if (spec.maps && normalized[spec.maps] === undefined) {
      normalized[spec.maps] = value;
    }
  }

  return { errors, warnings, options: normalized };
}

/**
 * Validates options and throws on errors, or on warnings when strict.
 *
 * @param {string} serviceName Service name
 * @param {string} providerType Provider name
 * @param {Object} options Options the caller passed
 * @param {Object} schemas Schemas keyed by service then provider
 * @param {{strict?: boolean, onWarning?: function(string): void}} [behaviour] Strict mode and warning sink
 * @return {Object} The options to pass to the factory
 * @throws {Error} When an option is invalid, or a warning occurs in strict mode
 */
function assertServiceOptions(serviceName, providerType, options, schemas, behaviour = {}) {
  const result = validateServiceOptions(serviceName, providerType, options, schemas);
  if (result.errors.length) {
    throw new Error(`Invalid options: ${result.errors.join('; ')}`);
  }
  if (result.warnings.length) {
    if (behaviour.strict) {
      throw new Error(`Invalid options (strictOptions): ${result.warnings.join('; ')}`);
    }
    for (const message of result.warnings) {
      behaviour.onWarning?.(message);
    }
  }
  return result.options;
}

/** Test hook: forget which warnings were already shown. */
function resetOptionWarnings() {
  warnedKeys.clear();
}

module.exports = {
  validateServiceOptions,
  assertServiceOptions,
  resetOptionWarnings,
  editDistance,
  COMMON_KEYS
};
