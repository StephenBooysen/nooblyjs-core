'use strict';

/**
 * @fileoverview Feature flags for the settings service (feature 13).
 *
 * Flag definitions are stored in the settings group `flags`, so they are
 * encrypted at rest and edited with the settings tools. Evaluation runs
 * in-process against a cached snapshot. The snapshot refreshes on settings
 * events in this process and on a poll, which picks up changes from other
 * processes that share the settings file.
 *
 * Evaluation order for a flag:
 *   1. not defined, or `enabled` is false: off
 *   2. any targeting rule matches (role, email domain, environment): on
 *   3. otherwise the rollout: a stable hash of the user id puts each user in a
 *      fixed bucket from 0 to 100, and the user is on when the bucket is below
 *      `rolloutPercent`. The same user gets the same answer across restarts.
 *
 * Variants split the enabled population by weight, on a hash that is separate
 * from the rollout hash.
 *
 * @module settings/modules/flags
 */

const crypto = require('node:crypto');
const { createOpenFeatureProvider } = require('./openFeatureProvider');
const fs = require('node:fs/promises');
const path = require('node:path');

/** Settings group that holds the flag definitions. */
const FLAG_GROUP = 'flags';

/** Flag names: letters, digits, dashes and underscores, starting with a letter or digit. */
const FLAG_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Identity used for rollout when the caller has no user id or email. */
const ANONYMOUS_ID = 'anonymous';

/** Rule types a definition may use. */
const RULE_TYPES = Object.freeze(['role', 'emailDomain', 'environment']);

/** Limits that keep a stored definition small. */
const LIMITS = Object.freeze({ rules: 20, values: 50, variants: 10, description: 500 });

/**
 * Maps an identity to a stable bucket from 0 (inclusive) to 100 (exclusive).
 * The salt separates independent decisions, such as rollout and variants.
 *
 * @param {string} salt Name of the decision, usually the flag name
 * @param {string} id Identity being bucketed
 * @return {number} Bucket in [0, 100)
 */
function bucketOf(salt, id) {
  const digest = crypto.createHash('sha256').update(`${salt}:${id}`).digest();
  return (digest.readUInt32BE(0) / 0x100000000) * 100;
}

/**
 * Validates and normalises a flag definition. Throws a message that is safe to
 * return to the caller.
 *
 * @param {string} name Flag name
 * @param {Object} input Raw definition
 * @return {Object} Normalised definition without timestamps
 * @throws {Error} When the name or any field is invalid
 */
function normalizeDefinition(name, input) {
  if (typeof name !== 'string' || !FLAG_NAME_PATTERN.test(name)) {
    throw new Error('Invalid flag name: use 1-64 letters, digits, dashes or underscores');
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid flag definition: expected an object');
  }

  const enabled = input.enabled === undefined ? false : input.enabled;
  if (typeof enabled !== 'boolean') throw new Error('Invalid flag: enabled must be a boolean');

  const rolloutPercent = input.rolloutPercent === undefined ? 0 : input.rolloutPercent;
  if (typeof rolloutPercent !== 'number' || !Number.isFinite(rolloutPercent)
      || rolloutPercent < 0 || rolloutPercent > 100) {
    throw new Error('Invalid flag: rolloutPercent must be a number from 0 to 100');
  }

  const description = input.description === undefined ? '' : input.description;
  if (typeof description !== 'string' || description.length > LIMITS.description) {
    throw new Error(`Invalid flag: description must be a string of at most ${LIMITS.description} characters`);
  }

  const rules = input.rules === undefined ? [] : input.rules;
  if (!Array.isArray(rules) || rules.length > LIMITS.rules) {
    throw new Error(`Invalid flag: rules must be a list of at most ${LIMITS.rules} rules`);
  }
  const normalizedRules = rules.map((rule) => {
    if (!rule || !RULE_TYPES.includes(rule.type)) {
      throw new Error(`Invalid flag rule: type must be one of ${RULE_TYPES.join(', ')}`);
    }
    if (!Array.isArray(rule.values) || rule.values.length === 0 || rule.values.length > LIMITS.values
        || rule.values.some((value) => typeof value !== 'string' || value.trim() === '')) {
      throw new Error(`Invalid flag rule: values must be 1-${LIMITS.values} non-empty strings`);
    }
    const values = rule.values.map((value) => value.trim().toLowerCase());
    return { type: rule.type, values: [...new Set(values)] };
  });

  const variants = input.variants === undefined ? [] : input.variants;
  if (!Array.isArray(variants) || variants.length > LIMITS.variants) {
    throw new Error(`Invalid flag: variants must be a list of at most ${LIMITS.variants} variants`);
  }
  const normalizedVariants = variants.map((variant) => {
    if (!variant || typeof variant.name !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(variant.name)) {
      throw new Error('Invalid flag variant: name must be 1-32 letters, digits, dashes or underscores');
    }
    if (!Number.isInteger(variant.weight) || variant.weight < 0 || variant.weight > 1000) {
      throw new Error('Invalid flag variant: weight must be an integer from 0 to 1000');
    }
    return { name: variant.name, weight: variant.weight };
  });
  if (new Set(normalizedVariants.map((v) => v.name)).size !== normalizedVariants.length) {
    throw new Error('Invalid flag: variant names must be unique');
  }
  if (normalizedVariants.length > 0 && normalizedVariants.reduce((sum, v) => sum + v.weight, 0) === 0) {
    throw new Error('Invalid flag: at least one variant needs a weight above 0');
  }

  const defaultVariant = input.defaultVariant === undefined ? 'control' : input.defaultVariant;
  if (typeof defaultVariant !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(defaultVariant)) {
    throw new Error('Invalid flag: defaultVariant must be a variant name');
  }

  const timestamp = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

  return {
    enabled,
    rolloutPercent,
    description,
    rules: normalizedRules,
    variants: normalizedVariants,
    defaultVariant,
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt)
  };
}

/**
 * Feature flag evaluator and manager. Created by the settings factory and
 * available as `settings.flags`.
 */
class FeatureFlags {
  /**
   * @param {Object} settings Settings service instance (the flag store)
   * @param {Object} [options]
   * @param {Object=} options.eventEmitter Shared emitter for settings and flag events
   * @param {Object=} options.logger Logging service
   * @param {number=} options.refreshMs Poll interval for changes made elsewhere (default 2000, 0 disables)
   * @param {boolean=} options.emitEvaluations Emit flags:evaluated on each evaluation (default true)
   */
  constructor(settings, options = {}) {
    this.settings_ = settings;
    this.eventEmitter_ = options.eventEmitter || null;
    this.logger_ = options.logger || null;
    this.emitEvaluations_ = options.emitEvaluations !== false;
    this.snapshot_ = new Map();
    this.lastEvaluatedAt_ = new Map();
    this.lastError_ = null;
    this.filepath_ = settings.settings?.filepath ? path.resolve(settings.settings.filepath) : null;
    this.mtime_ = null;

    this.onSettingsChange_ = (payload) => {
      if (payload && payload.group === FLAG_GROUP) this.refresh();
    };
    if (this.eventEmitter_ && typeof this.eventEmitter_.on === 'function') {
      this.eventEmitter_.on('settings:updated', this.onSettingsChange_);
      this.eventEmitter_.on('settings:created-key', this.onSettingsChange_);
    }

    const refreshMs = options.refreshMs === undefined ? 2000 : options.refreshMs;
    this.timer_ = null;
    if (refreshMs > 0) {
      this.timer_ = setInterval(() => this.poll_(), refreshMs);
      this.timer_.unref?.();
    }

    this.ready_ = this.poll_(true);
  }

  /**
   * Reloads the flag definitions from the store into the snapshot. Definitions
   * that fail validation are skipped and logged, so one bad entry does not
   * switch off every flag.
   *
   * @return {Promise<number>} Number of valid flags in the snapshot
   */
  async refresh() {
    let values = {};
    // Never read a store that does not exist yet: reading creates an empty
    // file, and the flags must not write anything until a flag is set.
    const inMemory = this.settings_.store_ != null;
    if (!inMemory && !(await this.fileExists_())) {
      this.snapshot_ = new Map();
      return 0;
    }
    try {
      values = await this.settings_.getGroup(FLAG_GROUP);
    } catch (error) {
      // No flags group yet: an empty snapshot is the right answer.
      if (!String(error.message).startsWith('Unknown settings group')) {
        this.lastError_ = error.message;
        this.logger_?.warn?.('[FLAGS] Could not read flag definitions', { error: error.message });
        return this.snapshot_.size;
      }
    }

    const next = new Map();
    for (const [name, raw] of Object.entries(values)) {
      try {
        next.set(name, normalizeDefinition(name, raw));
      } catch (error) {
        this.logger_?.warn?.('[FLAGS] Skipping invalid flag', { flag: name, error: error.message });
      }
    }
    this.snapshot_ = next;
    this.lastError_ = null;
    return next.size;
  }

  /**
   * Waits until the first snapshot has loaded.
   *
   * @return {Promise<void>}
   */
  async ready() {
    await this.ready_;
  }

  /**
   * Whether the settings file exists on disk.
   *
   * @return {Promise<boolean>}
   * @private
   */
  async fileExists_() {
    if (!this.filepath_) return true;
    try {
      await fs.access(this.filepath_);
      return true;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Checks the settings file for changes made by another process. When its
   * modification time has moved, the store is reloaded from disk and the
   * snapshot rebuilt. Runs on the poll timer, and once at start-up.
   *
   * @param {boolean=} initial True for the first load, which always reads
   * @return {Promise<void>}
   * @private
   */
  async poll_(initial = false) {
    try {
      if (!this.filepath_) {
        await this.refresh();
        return;
      }
      const stat = await fs.stat(this.filepath_).catch(() => null);
      if (!stat) {
        this.mtime_ = null;
        if (initial) await this.refresh();
        return;
      }
      if (initial || stat.mtimeMs !== this.mtime_) {
        this.mtime_ = stat.mtimeMs;
        if (!initial && typeof this.settings_.reload === 'function') {
          await this.settings_.reload();
        }
        await this.refresh();
      }
    } catch (error) {
      this.lastError_ = error.message;
    }
  }

  /**
   * Evaluates a flag for a caller.
   *
   * @param {string} name Flag name
   * @param {Object} [context] Who is asking
   * @param {string=} context.userId Stable user id, used for rollout and variants
   * @param {string=} context.email Email address, used by emailDomain rules
   * @param {string[]=} context.roles Roles, used by role rules
   * @param {string=} context.environment Environment name (defaults to NODE_ENV)
   * @return {Promise<{flag: string, enabled: boolean, variant: string, reason: string}>}
   */
  async evaluate(name, context = {}) {
    await this.ready_;
    const result = this.decide_(name, context);
    this.lastEvaluatedAt_.set(name, new Date().toISOString());
    if (this.emitEvaluations_ && this.eventEmitter_) {
      this.eventEmitter_.emit('flags:evaluated', {
        flag: name,
        enabled: result.enabled,
        variant: result.variant,
        reason: result.reason
      });
    }
    return result;
  }

  /**
   * An OpenFeature provider over these flags, for `OpenFeature.setProvider()`.
   * The OpenFeature SDK is not required by NooblyJS.
   *
   * @param {{name?: string}=} options
   * @return {Object} The provider
   */
  openFeatureProvider(options = {}) {
    return createOpenFeatureProvider(this, options);
  }

  /**
   * Whether a flag is on for a caller.
   *
   * @param {string} name Flag name
   * @param {Object} [context] See evaluate()
   * @return {Promise<boolean>}
   */
  async isEnabled(name, context = {}) {
    return (await this.evaluate(name, context)).enabled;
  }

  /**
   * The variant a caller sees. Off flags return the default variant.
   *
   * @param {string} name Flag name
   * @param {Object} [context] See evaluate()
   * @return {Promise<string>} Variant name, or 'on' / 'off' when the flag has no variants
   */
  async variant(name, context = {}) {
    return (await this.evaluate(name, context)).variant;
  }

  /**
   * Pure decision, used by evaluate(). No I/O and no events.
   *
   * @param {string} name Flag name
   * @param {Object} context Caller context
   * @return {{flag: string, enabled: boolean, variant: string, reason: string}}
   * @private
   */
  decide_(name, context) {
    const def = this.snapshot_.get(name);
    if (!def) return { flag: name, enabled: false, variant: 'off', reason: 'unknown' };

    const id = context.userId || context.email || ANONYMOUS_ID;
    const roles = Array.isArray(context.roles) ? context.roles.map((r) => String(r).toLowerCase()) : [];
    const email = typeof context.email === 'string' ? context.email.toLowerCase() : '';
    const environment = String(context.environment || process.env.NODE_ENV || '').toLowerCase();

    let enabled = false;
    let reason = 'off';
    if (!def.enabled) {
      reason = 'disabled';
    } else {
      const rule = def.rules.find((r) => this.ruleMatches_(r, { roles, email, environment }));
      if (rule) {
        enabled = true;
        reason = `rule:${rule.type}`;
      } else if (def.rolloutPercent >= 100) {
        enabled = true;
        reason = 'rollout';
      } else if (def.rolloutPercent > 0 && bucketOf(name, id) < def.rolloutPercent) {
        enabled = true;
        reason = 'rollout';
      } else {
        reason = 'rollout';
      }
    }

    let variant;
    if (def.variants.length === 0) {
      variant = enabled ? 'on' : 'off';
    } else if (!enabled) {
      variant = def.defaultVariant;
    } else {
      variant = this.pickVariant_(name, id, def.variants);
    }
    return { flag: name, enabled, variant, reason };
  }

  /**
   * Whether one targeting rule matches the caller.
   *
   * @param {{type: string, values: string[]}} rule Normalised rule
   * @param {{roles: string[], email: string, environment: string}} caller Lower-cased caller facts
   * @return {boolean}
   * @private
   */
  ruleMatches_(rule, caller) {
    if (rule.type === 'role') return rule.values.some((v) => caller.roles.includes(v));
    if (rule.type === 'emailDomain') {
      const at = caller.email.lastIndexOf('@');
      return at !== -1 && rule.values.includes(caller.email.slice(at + 1));
    }
    if (rule.type === 'environment') return rule.values.includes(caller.environment);
    return false;
  }

  /**
   * Chooses a variant by weight, using a hash that is independent of rollout.
   *
   * @param {string} name Flag name
   * @param {string} id Caller identity
   * @param {Array<{name: string, weight: number}>} variants Variants with weights
   * @return {string} Chosen variant name
   * @private
   */
  pickVariant_(name, id, variants) {
    const total = variants.reduce((sum, v) => sum + v.weight, 0);
    const point = (bucketOf(`${name}:variant`, id) / 100) * total;
    let cumulative = 0;
    for (const variant of variants) {
      cumulative += variant.weight;
      if (point < cumulative && variant.weight > 0) return variant.name;
    }
    return variants.find((v) => v.weight > 0).name;
  }

  /**
   * Lists every flag with its definition, timestamps and last evaluation time.
   * Used by the dashboard, to show flag age and stale flags.
   *
   * @return {Promise<Array<Object>>}
   */
  async list() {
    await this.ready_;
    return [...this.snapshot_.entries()].map(([name, def]) => ({
      name,
      ...def,
      lastEvaluatedAt: this.lastEvaluatedAt_.get(name) || null
    }));
  }

  /**
   * Creates or replaces a flag definition.
   *
   * @param {string} name Flag name
   * @param {Object} definition Flag definition (see normalizeDefinition)
   * @return {Promise<Object>} The stored definition
   * @throws {Error} When the name or definition is invalid
   */
  async set(name, definition) {
    const prior = this.snapshot_.get(name);
    const now = new Date().toISOString();
    const normalized = normalizeDefinition(name, definition);
    normalized.createdAt = prior?.createdAt || now;
    normalized.updatedAt = now;
    const existed = Boolean(prior);
    await this.settings_.set(name, normalized, FLAG_GROUP);
    await this.refresh();
    this.eventEmitter_?.emit?.('flags:changed', { flag: name, action: existed ? 'updated' : 'created' });
    return normalized;
  }

  /**
   * Deletes a flag definition.
   *
   * @param {string} name Flag name
   * @return {Promise<boolean>} True when the flag existed
   */
  async delete(name) {
    const removed = await this.settings_.delete(name, FLAG_GROUP).catch(() => false);
    await this.refresh();
    if (removed) this.eventEmitter_?.emit?.('flags:changed', { flag: name, action: 'deleted' });
    return Boolean(removed);
  }

  /**
   * Stops the poll and removes the settings listeners. Called by the registry
   * on reset and shutdown.
   *
   * @return {void}
   */
  destroy() {
    if (this.timer_) clearInterval(this.timer_);
    this.timer_ = null;
    if (this.eventEmitter_ && typeof this.eventEmitter_.removeListener === 'function') {
      this.eventEmitter_.removeListener('settings:updated', this.onSettingsChange_);
      this.eventEmitter_.removeListener('settings:created-key', this.onSettingsChange_);
    }
  }
}

module.exports = {
  FeatureFlags,
  FLAG_GROUP,
  bucketOf,
  normalizeDefinition
};
