/**
 * @fileoverview Runtime settings guard for filing providers (feature 15).
 *
 * A provider's storage identity — the local `baseDir`, an S3/GCP bucket, a git
 * remote or working directory, a remote API URL — is fixed at construction
 * time. Only the operational settings each provider lists in
 * `settings.list` (sizes, type lists, intervals, flags) may change at runtime,
 * and each value is validated against its declared type. Unknown or read-only
 * keys are rejected with `ClientError(400)` instead of being silently ignored,
 * so a request that tries to repoint the store fails loudly.
 *
 * @module filing/modules/settingsGuard
 */

'use strict';

const { ClientError } = require('../../shared/utils/httpErrors');

/**
 * File types a filing store accepts when `allowedTypes` is not configured:
 * documents and images only. Active types (html, htm, svg, xml, js) are left
 * out because they can run script when served from the application origin.
 * @const {string}
 */
const SAFE_ALLOWED_TYPES = 'md,txt,pdf,png,jpg,jpeg,gif,webp,csv,json,docx,xlsx,pptx';

/** Largest accepted value for a numeric setting (about 100 years in ms, or 9 PB). */
const MAX_NUMBER = Number.MAX_SAFE_INTEGER;

/** Longest accepted string setting. */
const MAX_STRING_LENGTH = 2000;

/**
 * Keys the dashboard echoes back from GET /settings that describe the settings
 * rather than being settings. They are ignored on save.
 * @const {!Set<string>}
 */
const DESCRIPTIVE_KEYS = new Set(['description', 'list']);

/**
 * Coerces and validates one setting value against its declared type.
 *
 * @param {string} key - Setting name (for error messages)
 * @param {string} type - Declared type: 'number', 'boolean' or 'string'
 * @param {*} value - Submitted value (form posts send strings)
 * @return {*} The coerced value
 * @throws {ClientError} When the value does not fit the type
 */
function coerceSetting(key, type, value) {
  if (type === 'number') {
    const num = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(num) || num < 0 || num > MAX_NUMBER || String(value).trim() === '') {
      throw new ClientError(400, `Setting "${key}" must be a non-negative number`);
    }
    return num;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'on' || value === '1') return true;
    if (value === 'false' || value === 'off' || value === '0') return false;
    throw new ClientError(400, `Setting "${key}" must be true or false`);
  }
  if (Array.isArray(value) && key === 'allowedTypes') {
    value = value.join(',');
  }
  if (typeof value !== 'string' || value.length > MAX_STRING_LENGTH) {
    throw new ClientError(400, `Setting "${key}" must be a string of at most ${MAX_STRING_LENGTH} characters`);
  }
  return value;
}

/**
 * Applies a settings update to a provider, accepting only the keys the
 * provider lists in `settings.list`.
 *
 * @param {Object} provider - Filing provider with a `settings` object
 * @param {*} input - The submitted settings
 * @param {Object=} logger - Optional logger
 * @return {!Object<string, *>} The settings that changed
 * @throws {ClientError} 400 for a non-object body, an unknown or read-only
 *     key, or a value of the wrong type. Nothing is applied in that case.
 *
 * @example
 * applySettings(provider, { maxFileSize: '2097152' }); // ok
 * applySettings(provider, { baseDir: '/' });           // throws ClientError(400)
 */
function applySettings(provider, input, logger) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ClientError(400, 'Settings must be a JSON object');
  }
  const list = (provider.settings && Array.isArray(provider.settings.list))
    ? provider.settings.list
    : [];
  const declared = new Map(list.map((entry) => [entry.setting, entry.type]));

  // Validate everything first so a bad key leaves the provider unchanged.
  const changes = {};
  for (const [key, value] of Object.entries(input)) {
    if (DESCRIPTIVE_KEYS.has(key) || value === null || value === undefined) continue;
    if (!declared.has(key)) {
      throw new ClientError(400, `Setting "${key}" cannot be changed at runtime`);
    }
    changes[key] = coerceSetting(key, declared.get(key), value);
  }

  for (const [key, value] of Object.entries(changes)) {
    provider.settings[key] = value;
    logger?.info?.(`[${provider.constructor.name}] Setting changed`, {
      setting: key,
      newValue: value,
      operation: 'saveSettings'
    });
  }
  return changes;
}

module.exports = { applySettings, coerceSetting, SAFE_ALLOWED_TYPES };
