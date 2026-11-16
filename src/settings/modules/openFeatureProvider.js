'use strict';

/**
 * @fileoverview OpenFeature provider for NooblyJS feature flags (feature 13).
 *
 * Wraps a FeatureFlags instance so the OpenFeature server SDK can use it:
 *
 *   const { OpenFeature } = require('@openfeature/server-sdk');
 *   OpenFeature.setProvider(createOpenFeatureProvider(registry.settings().flags));
 *   const client = OpenFeature.getClient();
 *   await client.getBooleanValue('new-checkout', false, { targetingKey: userId, roles: ['admin'] });
 *
 * The SDK is not required by NooblyJS. The provider has the methods and result
 * shape the SDK calls, so it works with any client that uses them.
 *
 * Context mapping: `targetingKey` is the user id (falls back to `email`).
 * `email`, `roles` (array, or comma-separated string) and `environment` are
 * read as-is.
 *
 * @module settings/modules/openFeatureProvider
 */

/** Result reasons from the OpenFeature specification. */
const REASON = {
  DEFAULT: 'DEFAULT',
  TARGETING_MATCH: 'TARGETING_MATCH',
  SPLIT: 'SPLIT',
  DISABLED: 'DISABLED',
  ERROR: 'ERROR'
};

/**
 * Converts an OpenFeature evaluation context into a FlagContext.
 *
 * @param {Object=} context OpenFeature EvaluationContext
 * @return {{userId?: string, email?: string, roles?: string[], environment?: string}}
 */
function toFlagContext(context = {}) {
  const out = {};
  const attributes = context || {};
  if (typeof attributes.targetingKey === 'string' && attributes.targetingKey) out.userId = attributes.targetingKey;
  if (typeof attributes.email === 'string') out.email = attributes.email;
  if (Array.isArray(attributes.roles)) out.roles = attributes.roles.map(String);
  else if (typeof attributes.roles === 'string') out.roles = attributes.roles.split(',').map((r) => r.trim()).filter(Boolean);
  if (typeof attributes.environment === 'string') out.environment = attributes.environment;
  return out;
}

class NooblyJSOpenFeatureProvider {
  /**
   * @param {Object} flags A FeatureFlags instance (settings.flags)
   * @param {Object=} options
   * @param {string=} options.name Provider name in metadata (default 'nooblyjs')
   */
  constructor(flags, options = {}) {
    if (!flags || typeof flags.evaluate !== 'function') {
      throw new Error('createOpenFeatureProvider needs a FeatureFlags instance');
    }
    this.flags_ = flags;
    this.metadata = { name: options.name || 'nooblyjs' };
  }

  /**
   * Evaluates a flag and returns the value of the requested type.
   *
   * @private
   * @param {string} flagKey
   * @param {*} defaultValue Returned when the flag is unknown or evaluation fails
   * @param {Object} context
   * @param {function(Object): *} pick Maps the decision to the value
   * @param {function(*): boolean} accepts Whether a value has the requested type
   * @return {Promise<{value: *, variant?: string, reason: string, errorCode?: string, errorMessage?: string}>}
   */
  async resolve_(flagKey, defaultValue, context, pick, accepts) {
    try {
      const decision = await this.flags_.evaluate(flagKey, toFlagContext(context));
      if (decision.reason === 'unknown') {
        return { value: defaultValue, reason: REASON.ERROR, errorCode: 'FLAG_NOT_FOUND', errorMessage: `Flag ${flagKey} does not exist` };
      }
      const value = pick(decision);
      if (!accepts(value)) {
        return { value: defaultValue, reason: REASON.ERROR, errorCode: 'TYPE_MISMATCH', errorMessage: `Flag ${flagKey} has a different type` };
      }
      return { value, variant: decision.variant, reason: reasonOf(decision) };
    } catch (error) {
      return { value: defaultValue, reason: REASON.ERROR, errorCode: 'GENERAL', errorMessage: error && error.message };
    }
  }

  /** @return {Promise<Object>} */
  async resolveBooleanEvaluation(flagKey, defaultValue, context) {
    return this.resolve_(flagKey, defaultValue, context, (d) => d.enabled, (v) => typeof v === 'boolean');
  }

  /** @return {Promise<Object>} The variant name */
  async resolveStringEvaluation(flagKey, defaultValue, context) {
    return this.resolve_(flagKey, defaultValue, context, (d) => d.variant, (v) => typeof v === 'string');
  }

  /** @return {Promise<Object>} The variant, read as a number */
  async resolveNumberEvaluation(flagKey, defaultValue, context) {
    return this.resolve_(flagKey, defaultValue, context, (d) => Number(d.variant), (v) => Number.isFinite(v));
  }

  /** @return {Promise<Object>} `{ enabled, variant }` */
  async resolveObjectEvaluation(flagKey, defaultValue, context) {
    return this.resolve_(flagKey, defaultValue, context, (d) => ({ enabled: d.enabled, variant: d.variant }), (v) => v !== null && typeof v === 'object');
  }
}

/**
 * Maps a NooblyJS decision to an OpenFeature reason. A rollout counts as SPLIT
 * only when the caller is inside it; outside, the default applies.
 *
 * @param {{enabled: boolean, reason: string}} decision
 * @return {string}
 */
function reasonOf(decision) {
  const { enabled, reason } = decision;
  if (reason === 'disabled') return REASON.DISABLED;
  if (reason && reason.startsWith('rule:')) return REASON.TARGETING_MATCH;
  if (reason === 'rollout' && enabled) return REASON.SPLIT;
  return REASON.DEFAULT;
}

/**
 * Creates an OpenFeature provider for a FeatureFlags instance.
 *
 * @param {Object} flags FeatureFlags (settings.flags)
 * @param {Object=} options See NooblyJSOpenFeatureProvider
 * @return {NooblyJSOpenFeatureProvider}
 */
function createOpenFeatureProvider(flags, options) {
  return new NooblyJSOpenFeatureProvider(flags, options);
}

module.exports = { createOpenFeatureProvider, toFlagContext, reasonOf, REASON };
