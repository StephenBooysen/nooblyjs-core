/**
 * @fileoverview Validates the options passed to a service factory against the
 * service's `options.schema.js` (feature 08).
 *
 * - A key that looks like a typo of a known key warns with a suggestion
 *   ("did you mean `redisUrl`?"), on every provider.
 * - Other unknown keys warn only on providers that read a fixed set of keys
 *   (providers that pass extra options to a client library accept them).
 * - A wrong type throws, naming the service, provider and key.
 * - A legacy spelling (`redisurl`) is copied to the provider's key and warns
 *   once, pointing at the canonical name (`redisUrl`).
 * - With `strictOptions: true`, every warning is an error (use it in CI).
 *
 * Warnings are reported once per service, provider and key per process.
 *
 * A schema module exports:
 * ```javascript
 * module.exports = {
 *   common: { properties: { ... } },                 // every provider
 *   providers: {
 *     redis: { properties: { ... }, open: true,      // open: passes extras to the client
 *              aliases: { redisUrl: 'redisurl' } },  // canonical -> key the provider reads
 *   },
 * };
 * ```
 *
 * @module shared/utils/serviceOptions
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateSchema, closestKey } = require('./jsonSchema');

/**
 * Keys the registry or the host adds to any service's options; never warned.
 * @const {!Set<string>}
 */
const REGISTRY_KEYS = new Set([
  'dependencies', 'instanceName', 'express-app', 'ServiceRegistry', 'providerType', 'authMiddleware',
  'security', 'apiKeys', 'requireApiKey', 'excludePaths', 'adminApiKeys', 'logger', 'strictOptions',
  'dataDir', 'logDir', 'eventEmitter', 'settings'
]);

/** @type {!Set<string>} */
const reported = new Set();
/** @type {!Map<string, ?Object>} */
const schemaCache = new Map();

/**
 * Loads `src/{service}/options.schema.js` if the service has one.
 * @param {string} serviceName - Service folder name
 * @param {string=} srcDir - Directory holding the service folders
 * @return {?Object}
 */
function loadSchema(serviceName, srcDir = path.join(__dirname, '..', '..')) {
  const key = `${srcDir}:${serviceName}`;
  if (!schemaCache.has(key)) {
    const file = path.join(srcDir, serviceName, 'options.schema.js');
    schemaCache.set(key, fs.existsSync(file) ? require(file) : null);
  }
  return schemaCache.get(key);
}

/**
 * Checks (and, for aliases, normalises) a service's options.
 *
 * @param {string} serviceName - e.g. 'caching'
 * @param {string} providerType - e.g. 'redis'
 * @param {!Object} options - The caller's options (not the merged globals)
 * @param {Object=} context - `{ strict, report(message, detail), schema }`
 * @return {{options: !Object, warnings: !Array<string>}} Options with aliases applied
 * @throws {Error} On a wrong type, or on any warning in strict mode
 */
function checkServiceOptions(serviceName, providerType, options, context = {}) {
  const schema = context.schema !== undefined ? context.schema : loadSchema(serviceName);
  if (!schema || !options || typeof options !== 'object') return { options, warnings: [] };
  const provider = (schema.providers && schema.providers[providerType]) || null;
  if (!provider && !schema.common) return { options, warnings: [] };

  const properties = { ...((schema.common && schema.common.properties) || {}), ...((provider && provider.properties) || {}) };
  const aliases = { ...((schema.common && schema.common.aliases) || {}), ...((provider && provider.aliases) || {}) };
  const legacyToCanonical = Object.fromEntries(Object.entries(aliases).map(([canonical, legacy]) => [legacy, canonical]));
  const open = Boolean(provider ? provider.open : schema.common && schema.common.open);
  const label = `${serviceName}('${providerType}')`;
  const warnings = [];
  const out = { ...options };

  for (const [canonical, legacy] of Object.entries(aliases)) {
    if (out[canonical] !== undefined && out[legacy] === undefined) out[legacy] = out[canonical];
  }

  // Suggest canonical names first, never the legacy spellings they replace.
  const legacyKeys = new Set(Object.values(aliases));
  const known = [...Object.keys(aliases), ...Object.keys(properties).filter((k) => !legacyKeys.has(k))];
  for (const key of Object.keys(options)) {
    if (REGISTRY_KEYS.has(key) || options[key] === undefined) continue;
    if (legacyToCanonical[key]) {
      warnings.push(`${label}: option "${key}" is a legacy spelling; use "${legacyToCanonical[key]}"`);
      continue;
    }
    if (properties[key] || aliases[key]) continue;
    const suggestion = closestKey(key, known);
    if (suggestion) {
      warnings.push(`${label}: unknown option "${key}"; did you mean "${suggestion}"?`);
    } else if (!open && provider) {
      warnings.push(`${label}: unknown option "${key}" (valid: ${Object.keys(properties).sort().join(', ')})`);
    }
  }

  const typeErrors = validateSchema({ type: 'object', properties }, out)
    .map((e) => `${label}: option "${e.path.replace(/^\$\.?/, '')}" ${e.message}`);
  if (typeErrors.length) {
    throw new Error(`Invalid options for ${typeErrors.join('; ')}`);
  }

  if (warnings.length && context.strict) {
    throw new Error(`Invalid options (strictOptions): ${warnings.join('; ')}`);
  }
  for (const message of warnings) {
    const id = `${serviceName}:${providerType}:${message}`;
    if (reported.has(id)) continue;
    reported.add(id);
    if (typeof context.report === 'function') context.report(message);
  }
  return { options: out, warnings };
}

/** Forgets which warnings were reported (tests). */
function resetReported() {
  reported.clear();
}

module.exports = { checkServiceOptions, loadSchema, resetReported, REGISTRY_KEYS };
