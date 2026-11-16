/**
 * @fileoverview Settings Service Factory
 * Factory module for creating settings service instances that manage grouped
 * key/value configuration securely. The default provider keeps every value in
 * a single AES-256-GCM encrypted JSON file.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

// Providers
const SettingsFile = require('./providers/settings');
const { FeatureFlags } = require('./modules/flags');

// Routes, views and client scripts
const Routes = require('./routes');
const Views = require('./views');
const Scripts = require('./scripts');

/**
 * Creates a settings service instance with the specified provider and
 * dependency injection. Automatically configures routes and views.
 *
 * @param {string} type - The settings provider type ('file', 'encrypted', 'default')
 * @param {Object} options - Provider-specific configuration options
 * @param {string} [options.filepath] - Path of the encrypted settings file
 * @param {string} [options.secret] - Master secret used to derive the encryption
 *     key (falls back to SETTINGS_SECRET, then SESSION_SECRET)
 * @param {boolean} [options.autosave=true] - Persist on every change
 * @param {boolean} [options.maskSecrets=true] - Mask values flagged as secret
 * @param {string} [options.instanceName='default'] - Unique identifier for this instance
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {SettingsFile} Settings service instance with the specified provider
 *
 * @example
 * const settings = createSettingsService('file', {
 *   filepath: './.application/settings/settings.enc.json',
 *   secret: process.env.SETTINGS_SECRET,
 *   dependencies: { logging }
 * }, eventEmitter);
 *
 * // Write a grouped setting, flagged as a secret so the UI masks it
 * await settings.set('password', 'hunter2', 'smtp', { secret: true });
 *
 * // Read a single value, or a whole group
 * const password = await settings.get('smtp.password');
 * const smtp = await settings.getGroup('smtp', { reveal: true });
 */
function createSettingsService(type, options, eventEmitter) {

  // Extract the dependencies from the options
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;

  // Create the settings service instance based on provider type
  let settingsService;

  switch (type) {
    case 'file':
    case 'encrypted':
    default:
      settingsService = new SettingsFile(providerOptions, eventEmitter);
      break;
  }

  // Inject logging dependency into the settings service
  if (logger) {
    settingsService.logger = logger;
    settingsService.log = (level, message, meta = {}) => {
      if (typeof logger[level] === 'function') {
        logger[level](`[SETTINGS:${String(type || 'file').toUpperCase()}] ${message}`, meta);
      }
    };

    settingsService.log('info', 'Settings service initialized', {
      provider: type || 'file',
      filepath: settingsService.settings.filepath,
      hasLogging: true
    });

    // Values are only as safe as the secret used to encrypt them, so make a
    // fallback secret loud rather than silent.
    if (settingsService.usingFallbackSecret_) {
      settingsService.log('warn', 'Settings encrypted with the built-in development secret', {
        remedy: 'Set SETTINGS_SECRET (or pass options.secret) before storing production values'
      });
    }
  }

  // Store all dependencies for potential use by the provider
  settingsService.dependencies = dependencies;

  // Feature flags (feature 13) live in the `flags` group of this store.
  // The registry destroys `analytics` on reset, which stops the flag poll and
  // removes the settings listeners.
  settingsService.flags = new FeatureFlags(settingsService, {
    eventEmitter,
    logger,
    refreshMs: options.flagsRefreshMs
  });
  settingsService.analytics = settingsService.flags;

  // Initialize routes, views and client scripts for the settings service
  Routes(options, eventEmitter, settingsService);
  Views(options, eventEmitter, settingsService);
  Scripts(options, eventEmitter, settingsService);

  return settingsService;
}

module.exports = createSettingsService;
