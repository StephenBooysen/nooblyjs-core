/**
 * @fileoverview Authentication Service Factory
 * Factory module for creating authentication service instances with multiple provider support.
 * Supports passport local strategy and Google OAuth with user management and role-based access.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const AuthPassport = require('./providers/authPassport');
const AuthGoogle = require('./providers/authGoogle');
const AuthAzure = require('./providers/authAzure');
const AuthMemory = require('./providers/authMemory');
const AuthFile = require('./providers/authFile');
const AuthApi = require('./providers/authApi');
const AuthSecureEmail = require('./providers/authSecureEmail');

const Routes = require('./routes');
const Views = require('./views');
const AuthAnalytics = require('./modules/analytics');
const middleware = require('./middleware');

/**
 * Creates a helper that curries the passport configuration with the provided
 * strategy configuration or factory. This is useful when consumers want a
 * composable interface instead of pulling middleware directly.
 *
 * @param {(Function|Object)} strategyFactoryOrConfig Strategy factory or config object
 * @returns {{configurePassport: function(Object=): Object}} Configurator wrapper
 */
function passportConfigurator(strategyFactoryOrConfig) {
  return {
    configurePassport(passportInstance) {
      return middleware.configurePassport(strategyFactoryOrConfig, passportInstance);
    }
  };
}

/**
 * Creates an authentication service instance with the specified provider.
 * Automatically configures routes and views for the auth service.
 * @param {string} type - The auth provider type ('passport', 'google', 'azure', 'memory', 'file', 'api', 'secure-email')
 * @param {Object} options - Provider-specific configuration options
 * @param {Object} options.dependencies - Injected service dependencies
 * @param {Object} options.dependencies.logging - Logging service instance
 * @param {Object} options.dependencies.caching - Caching service instance
 * @param {Object} options.dependencies.dataservice - DataService instance for user storage
 * @param {EventEmitter} eventEmitter - Global event emitter for inter-service communication
 * @return {AuthPassport|AuthGoogle|AuthMemory|AuthFile|AuthApi} Auth service instance with specified provider
 * @throws {Error} When unsupported auth type is provided
 * @example
 * const authService = createAuth('passport', {
 *   dependencies: { logging, caching, dataservice }
 * }, eventEmitter);
 *
 * // Register a new user
 * await authService.register('user@example.com', 'securepassword', {
 *   name: 'John Doe',
 *   role: 'user'
 * });
 *
 * // Authenticate a user
 * const user = await authService.authenticate('user@example.com', 'securepassword');
 *
 * // Check permissions
 * const hasAccess = authService.hasPermission(user, 'admin');
 *
 * @example
 * // Google OAuth provider
 * const googleAuth = createAuth('google', {
 *   clientID: process.env.GOOGLE_CLIENT_ID,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *   // Register this exact URL in Google Cloud Console; core answers its path.
 *   callbackURL: 'https://your-app.example/services/authservice/api/google/callback',
 *   dependencies: { logging, caching, dataservice }
 * }, eventEmitter);
 */
function createAuth(type, options, eventEmitter) {
  let auth;
  const analytics = new AuthAnalytics(eventEmitter);

  // Create auth instance based on provider type
  switch (type) {
    case 'passport':
      auth = new AuthPassport(options, eventEmitter);
      break;
    case 'google':
      auth = new AuthGoogle(options, eventEmitter);
      break;
    case 'azure':
      auth = new AuthAzure(options, eventEmitter);
      break;
    case 'file':
      auth = new AuthFile(options, eventEmitter);
      break;
    case 'api':
      auth = new AuthApi(options, eventEmitter);
      break;
    case 'secure-email':
      auth = new AuthSecureEmail(options, eventEmitter);
      break;
    case 'memory':
    default:
      auth = new AuthMemory(options, eventEmitter);
      break;
  }

  // Initialize routes and views for the auth service
  Routes(options, eventEmitter, auth, analytics);
  Views(options, eventEmitter, auth);

  // Attach passport configurator helper directly on the auth instance for convenience
  auth.passportConfigurator = function attachPassportConfigurator(customStrategyFactory) {
    const resolvedFactory =
      customStrategyFactory ||
      (typeof this.getAuthStrategy === 'function' ? this.getAuthStrategy : null);

    if (!resolvedFactory) {
      throw new Error('Passport configurator requested but no strategy factory available for this provider.');
    }

    return passportConfigurator(resolvedFactory);
  };

  // Expose analytics so the registry can remove its listeners on shutdown/reset (P2-6).
  auth.analytics = analytics;
  return auth;
}

// Expose middleware helpers directly from authservice factory
createAuth.middleware = middleware;
createAuth.createApiKeyAuthMiddleware = middleware.createApiKeyAuthMiddleware;
createAuth.generateApiKey = middleware.generateApiKey;
createAuth.isValidApiKeyFormat = middleware.isValidApiKeyFormat;
createAuth.createServicesAuthMiddleware = middleware.createServicesAuthMiddleware;
createAuth.configurePassport = middleware.configurePassport;
createAuth.passportConfigurator = passportConfigurator;
createAuth.createAuthMiddleware = middleware.createAuthMiddleware;
createAuth.createAuthMiddlewareWithHandler = middleware.createAuthMiddlewareWithHandler;

module.exports = createAuth;
