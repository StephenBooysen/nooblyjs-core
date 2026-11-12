/**
 * @fileoverview Google OAuth Authentication Provider
 * Google OAuth authentication provider using passport-google-oauth20.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const { postLoginRedirect, safeReturnUrl } = require('../modules/redirect');
const AuthBase = require('./authBase');

/**
 * Google OAuth authentication provider.
 * Integrates with passport Google OAuth2 strategy for authentication.
 * @class
 * @extends {AuthBase}
 */
class AuthGoogle extends AuthBase {
  /**
   * Initializes the Google OAuth authentication provider.
   * @param {Object=} options Configuration options.
   * @param {string} options.clientID Google OAuth client ID.
   * @param {string} options.clientSecret Google OAuth client secret.
   * @param {string} options.callbackURL Callback URL for OAuth flow.
   * @param {Object} options.express-app Express app instance for passport setup.
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.settings = {};
    this.settings.desciption = "This provider exposes the NooblyJS google auth implementation settings"
    this.settings.list = []

    this.passport_ = null;
    this.GoogleStrategy_ = null;
    this.clientID_ = options.clientID;
    this.clientSecret_ = options.clientSecret;
    this.callbackURL_ = options.callbackURL || '/auth/google/callback';

    this.initializePassport_();

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:provider-initialized', {
        provider: 'google',
        message: 'Google OAuth auth provider initialized'
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
   * Initializes passport with Google OAuth strategy.
   * @private
   */
  initializePassport_() {
    try {
      this.passport_ = require('passport');
      this.GoogleStrategy_ = require('passport-google-oauth20').Strategy;

      if (!this.clientID_ || !this.clientSecret_) {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('auth:google-config-missing', {
            message: 'Google OAuth client ID and secret required'
          });
        }
        return;
      }

      // Configure Google OAuth strategy
      this.passport_.use(new this.GoogleStrategy_(
        {
          clientID: this.clientID_,
          clientSecret: this.clientSecret_,
          callbackURL: this.callbackURL_
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const result = await this.handleGoogleAuth_(profile, accessToken, refreshToken);
            return done(null, result.user, { session: result.session });
          } catch (error) {
            return done(error, null);
          }
        }
      ));

      // Serialize user for session - only register once
      const hasSerializers = this.passport_._serializers && this.passport_._serializers.length > 0;

      if (!hasSerializers) {
        this.passport_.serializeUser((user, done) => {
          try {
            if (!user || !user.email) {
              return done(new Error('User object must have an email property'));
            }
            done(null, user.email);
          } catch (error) {
            done(error);
          }
        });

        // Deserialize user from session
        this.passport_.deserializeUser(async (email, done) => {
          try {
            if (!email) {
              return done(new Error('Email is required for deserialization'));
            }
            const user = await this.getUser(email);
            done(null, user);
          } catch (error) {
            done(error, null);
          }
        });
      }

      // Initialize passport with express app if provided
      if (this.options_['express-app']) {
        const app = this.options_['express-app'];
        app.use(this.passport_.initialize());
        app.use(this.passport_.session());
      }

    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:google-unavailable', {
          message: 'passport-google-oauth20 package not installed',
          error: error.message
        });
      }
    }
  }

  /**
   * Handles Google OAuth authentication result.
   * @param {Object} profile Google profile object.
   * @param {string} accessToken OAuth access token.
   * @param {string} refreshToken OAuth refresh token.
   * @param {string} returnUrl Optional return URL for post-login redirect.
   * @return {Promise<Object>} Promise resolving to authentication result.
   * @private
   */
  async handleGoogleAuth_(profile, accessToken, refreshToken, returnUrl) {
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
    const fullName = profile.displayName || email; // Use Google display name as full name

    let user;
    try {
      // Try to get existing user (identified by email)
      user = await this.getUser(email);
    } catch (error) {
      // User doesn't exist, create new one
      user = await this.createUser({
        email,
        fullName,
        // OAuth users never sign in with a password; store an unguessable one (P0-3).
        password: this.generateStrongPassword(), // Random strong password for OAuth users
        role: 'user'
      });
    }

    // Update user with Google-specific data
    await this.updateUser(email, {
      fullName,
      googleId: profile.id,
      accessToken,
      refreshToken,
      lastLogin: new Date()
    });

    // Create session
    const sessionToken = this.generateSessionToken_();
    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
    const session = {
      token: sessionToken,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: userRoles,
      provider: 'google',
      createdAt: new Date(),
      lastActivityAt: Date.now(),
      expiresAt: new Date(Date.now() + this.sessionConfig_().absoluteTimeoutMs)
    };

    this.sessions_.set(sessionToken, session);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:google-login', {
        email,
        roles: userRoles
      });
    }

    // Where to go next: the page they were heading to > the app's loginSuccessRedirectUrl > /services
    const redirectUrl = postLoginRedirect(returnUrl, this.options_);

    return {
      user: this.getSafeUser_(user),
      session: { token: sessionToken, expiresAt: session.expiresAt },
      redirectUrl: redirectUrl
    };
  }

  /**
   * Initiates Google OAuth flow.
   * @param {Object} req Express request object.
   * @param {Object} res Express response object.
   * @param {Function} next Express next function.
   */
  initiateGoogleAuth(req, res, next) {
    if (!this.passport_) {
      throw new Error('Google OAuth not available');
    }

    // Store returnUrl in session for use in callback (same-origin paths only: no open redirect)
    const returnUrl = safeReturnUrl(req.query.returnUrl);
    if (returnUrl) {
      req.session = req.session || {};
      req.session.oauthReturnUrl = returnUrl;
    }

    this.passport_.authenticate('google', {
      scope: ['profile', 'email']
    })(req, res, next);
  }

  /**
   * Handles Google OAuth callback.
   * @param {Object} req Express request object.
   * @param {Object} res Express response object.
   * @param {Function} next Express next function.
   * @return {Promise<Object>} Promise resolving to authentication result.
   */
  async handleGoogleCallback(req, res, next) {
    if (!this.passport_) {
      throw new Error('Google OAuth not available');
    }

    // Retrieve returnUrl from session
    const returnUrl = req.session?.oauthReturnUrl;

    return new Promise((resolve, reject) => {
      this.passport_.authenticate('google', (err, user, info) => {
        if (err) {
          return reject(err);
        }
        if (!user) {
          return reject(new Error('Google authentication failed'));
        }

        req.logIn(user, (err) => {
          if (err) {
            return reject(err);
          }
          // Pass returnUrl to the response
          const result = { user, session: info.session };
          if (info.redirectUrl) {
            result.redirectUrl = info.redirectUrl;
          } else if (returnUrl) {
            result.redirectUrl = returnUrl;
          }
          // Clean up the session
          if (req.session) {
            delete req.session.oauthReturnUrl;
          }
          resolve(result);
        });
      })(req, res, next);
    });
  }

  /**
   * Middleware for protecting routes with Google OAuth.
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
   * Gets service status with Google OAuth-specific information.
   * @return {Promise<Object>} Promise resolving to status object.
   */
  async getStatus() {
    const baseStatus = await super.getStatus();
    return {
      ...baseStatus,
      provider: 'google',
      passportAvailable: !!this.passport_,
      strategy: 'google-oauth20',
      configured: !!(this.clientID_ && this.clientSecret_)
    };
  }
}

module.exports = AuthGoogle;