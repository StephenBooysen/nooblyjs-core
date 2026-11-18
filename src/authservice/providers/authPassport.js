/**
 * @fileoverview Passport Authentication Provider
 * Passport.js local strategy authentication provider.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const AuthBase = require('./authBase');

/**
 * Passport.js authentication provider.
 * Integrates with passport local strategy for authentication.
 * @class
 * @extends {AuthBase}
 */
class AuthPassport extends AuthBase {
  /**
   * Initializes the passport authentication provider.
   * @param {Object=} options Configuration options.
   * @param {Object} options.express-app Express app instance for passport setup.
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.settings = {};
    this.settings.desciption = "There are not settinsg for the nooblyjs-core passpwrt auth implementation"
    this.settings.list = []

    this.passport_ = null;
    this.initializePassport_();

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:provider-initialized', {
        provider: 'passport',
        message: 'Passport auth provider initialized'
      });
    }
  }

  /**
   * Get all our settings
   */
  async getSettings(){
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings){
    for (let i=0; i < this.settings.list.length; i++){
      if (settings[this.settings.list[i].setting] != null){
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting]
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('auth:setting-changed', {
            setting: this.settings.list[i].setting,
            value: settings[this.settings.list[i].setting]
          });
        }
      }
    }
  }


  /**
   * Initializes passport with local strategy.
   * @private
   */
  initializePassport_() {
    try {
      this.passport_ = require('passport');
      const strategyConfig = super.getAuthStrategy();

      if (strategyConfig && typeof strategyConfig === 'object') {
        const {
          strategy,
          serializeUser,
          deserializeUser
        } = strategyConfig;

        if (strategy) {
          this.passport_.use(strategy);
        }

        // Only register serialization once to avoid conflicts with multiple instances
        // Check if already registered by looking at internal state
        const hasSerializers = this.passport_._serializers && this.passport_._serializers.length > 0;

        if (typeof serializeUser === 'function' && !hasSerializers) {
          this.passport_.serializeUser(serializeUser);
        }

        if (typeof deserializeUser === 'function' && !hasSerializers) {
          this.passport_.deserializeUser(deserializeUser);
        }
      }

    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:passport-unavailable', {
          message: 'Passport packages not installed',
          error: error.message
        });
      }
    }
  }

  /**
   * Authenticates using passport local strategy.
   * @param {Object} req Express request object.
   * @param {Object} res Express response object.
   * @param {Function} next Express next function.
   * @return {Promise<Object>} Promise resolving to authentication result.
   */
  async authenticateWithPassport(req, res, next) {
    if (!this.passport_) {
      throw new Error('Passport not available');
    }

    return new Promise((resolve, reject) => {
      this.passport_.authenticate('local', (err, user, info) => {
        if (err) {
          return reject(err);
        }
        if (!user) {
          return reject(new Error(info.message || 'Authentication failed'));
        }

        req.logIn(user, (err) => {
          if (err) {
            return reject(err);
          }
          resolve({ user, session: info.session });
        });
      })(req, res, next);
    });
  }

  /**
   * Middleware for protecting routes with passport.
   * @param {Object} req Express request object.
   * @param {Object} res Express response object.
   * @param {Function} next Express next function.
   */
  requireAuth(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  }

  /**
   * Middleware for role-based access control.
   * @param {string|Array<string>} roles Required roles.
   * @return {Function} Middleware function.
   */
  requireRole(roles) {
    const requiredRoles = Array.isArray(roles) ? roles : [roles];

    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role || 'user'];
      if (!requiredRoles.some(role => userRoles.includes(role))) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    };
  }

  /**
   * Gets passport instance.
   * @return {Object} Passport instance.
   */
  getPassport() {
    return this.passport_;
  }

  /**
   * Gets service status with passport-specific information.
   * @return {Promise<Object>} Promise resolving to status object.
   */
  async getStatus() {
    const baseStatus = await super.getStatus();
    return {
      ...baseStatus,
      provider: 'passport',
      passportAvailable: !!this.passport_,
      strategy: 'local'
    };
  }

  /**
   * Provides a factory that yields the passport strategy and serializers.
   * @return {?Function} Factory function returning strategy configuration.
   */
  getAuthStrategy() {
    return super.getAuthStrategy();
  }
}

module.exports = AuthPassport;
