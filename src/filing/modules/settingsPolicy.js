'use strict';

/**
 * @fileoverview Runtime settings policy for filing providers (feature 15).
 *
 * Filing settings can be changed over the API while the service runs, so each
 * provider declares exactly which settings may change at runtime and how each
 * value is validated. Anything else is refused:
 *
 * - **fixed** settings (the storage root, bucket, region, remote URL) are set
 *   at construction time only. Sending the value the instance already has is a
 *   harmless no-op; sending a different value is a 400.
 * - **unknown** keys are a 400, so a typo or a probing request never silently
 *   does nothing.
 * - **read-only metadata** the GET endpoint echoes (`description`, `list`) is
 *   ignored, so a client can round-trip the GET response.
 *
 * @module filing/modules/settingsPolicy
 */

const { ClientError } = require('../../shared/utils/httpErrors');

/** Keys the GET endpoint returns as metadata; accepted and ignored on save. */
const METADATA_KEYS = new Set(['description', 'list']);

/** Extension, MIME or MIME-wildcard token, or the '*' wildcard. */
const FILE_TYPE_TOKEN = /^(\*|\.[a-z0-9]{1,10}|[a-z0-9]{1,10}|[a-z0-9.+-]+\/(\*|[a-z0-9.+-]+))$/;

/**
 * Builds a validator for a bounded number.
 *
 * @param {string} name - Setting name, for error messages
 * @param {{min: number, max: number, integer?: boolean}} range - Accepted range
 * @return {function(*): number} Validator returning the normalised number
 */
function numberRule(name, { min, max, integer = false }) {
  return (value) => {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    const valid = typeof parsed === 'number'
      && Number.isFinite(parsed)
      && (!integer || Number.isInteger(parsed))
      && parsed >= min
      && parsed <= max;
    if (!valid) {
      throw new ClientError(400,
        `${name} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}`);
    }
    return parsed;
  };
}

/**
 * Builds a validator for a boolean (accepts true/false and their string forms,
 * since HTML form fields post strings).
 *
 * @param {string} name - Setting name, for error messages
 * @return {function(*): boolean} Validator returning the normalised boolean
 */
function booleanRule(name) {
  return (value) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new ClientError(400, `${name} must be true or false`);
  };
}

/**
 * Builds a validator for a bounded, single-line string.
 *
 * @param {string} name - Setting name, for error messages
 * @param {number} maxLength - Maximum length in characters
 * @return {function(*): string} Validator returning the trimmed string
 */
function stringRule(name, maxLength) {
  return (value) => {
    if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength
      || /[\r\n\0]/.test(value)) {
      throw new ClientError(400, `${name} must be a single line of 1 to ${maxLength} characters`);
    }
    return value.trim();
  };
}

/**
 * Builds a validator for an allow-list of file types, normalised to the
 * comma-separated string the upload middleware reads.
 *
 * @param {string} name - Setting name, for error messages
 * @return {function(*): string} Validator returning e.g. '.pdf,.md,image/*'
 */
function fileTypesRule(name) {
  return (value) => {
    const items = Array.isArray(value) ? value : String(value).split(',');
    const tokens = items.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0 || tokens.some((token) => !FILE_TYPE_TOKEN.test(token))) {
      throw new ClientError(400,
        `${name} must be a comma-separated list of extensions (.pdf), MIME types (image/png) or *`);
    }
    return tokens.join(',');
  };
}

/**
 * Validates a settings update against a provider's policy and returns the
 * normalised values to apply. Nothing is applied unless every key passes.
 *
 * @param {*} body - The request body or settings object
 * @param {{rules: Object<string, function(*): *>, fixed: Object<string, *>}} policy
 *     `rules` maps each runtime-changeable setting to its validator; `fixed`
 *     maps construction-time settings to their current value
 * @return {Object<string, *>} The validated updates, keyed by setting name
 * @throws {ClientError} 400 for a non-object body, a fixed setting that would
 *     change, an unknown key, or a value that fails validation
 *
 * @example
 * applyRuntimeSettings({ maxFileSize: '2048' }, { rules, fixed }); // { maxFileSize: 2048 }
 * applyRuntimeSettings({ baseDir: '/' }, { rules, fixed });       // throws 400
 */
function applyRuntimeSettings(body, { rules, fixed }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ClientError(400, 'Settings must be a JSON object');
  }

  const updates = {};
  for (const [key, value] of Object.entries(body)) {
    if (METADATA_KEYS.has(key)) continue;

    if (Object.prototype.hasOwnProperty.call(fixed, key)) {
      if (String(value) === String(fixed[key])) continue;
      throw new ClientError(400,
        `${key} is fixed when the filing instance is created and cannot be changed at runtime`);
    }

    if (!Object.prototype.hasOwnProperty.call(rules, key)) {
      throw new ClientError(400, `Unknown or read-only setting: ${key}`);
    }
    updates[key] = rules[key](value);
  }
  return updates;
}

module.exports = {
  applyRuntimeSettings,
  numberRule,
  booleanRule,
  stringRule,
  fileTypesRule
};
