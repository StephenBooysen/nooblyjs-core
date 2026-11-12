/**
 * @fileoverview Azure AD (Microsoft Entra ID) Authentication Provider
 * Azure Active Directory / Microsoft Entra ID authentication provider using
 * passport-azure-ad's OpenID Connect strategy. Configuration is sourced from
 * the AZURE_AD_* environment variables when not supplied via options.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const { requireOptional } = require('../../shared/utils/requireOptional');

const { postLoginRedirect, safeReturnUrl } = require('../modules/redirect');
const AuthBase = require('./authBase');

/**
 * Passport strategy name registered for the Azure AD OpenID Connect strategy.
 * This is the default name used by passport-azure-ad's OIDCStrategy.
 * @const {string}
 */
const AZURE_STRATEGY_NAME = 'azuread-openidconnect';

/**
 * Fixed application path that Azure AD redirects back to after sign-in. The
 * host portion (scheme://host[:port]) is environment-specific and supplied via
 * AZURE_AD_BASE_URL, so only this path is hard-coded.
 * @const {string}
 */
const AZURE_CALLBACK_PATH = '/services/authservice/openid';

/**
 * Azure AD (Microsoft Entra ID) authentication provider.
 * Integrates with passport-azure-ad's OpenID Connect strategy for authentication.
 *
 * Configuration precedence: explicit {@code options} values override the
 * corresponding {@code AZURE_AD_*} environment variables.
 *
 * @class
 * @extends {AuthBase}
 *
 * @example
 * // Configured entirely from AZURE_AD_* environment variables
 * const azureAuth = createAuth('azure', {
 *   'express-app': app,
 *   dependencies: { logging, dataservice }
 * }, eventEmitter);
 */
class AuthAzure extends AuthBase {
  /**
   * Initializes the Azure AD authentication provider.
   * @param {Object=} options Configuration options.
   * @param {string=} options.clientID Azure AD application (client) ID.
   *     Falls back to {@code process.env.AZURE_AD_CLIENT_ID}.
   * @param {string=} options.clientSecret Azure AD client secret.
   *     Falls back to {@code process.env.AZURE_AD_SECRET}.
   * @param {string=} options.tenantID Azure AD directory (tenant) ID.
   *     Falls back to {@code process.env.AZURE_AD_TENANT_ID}.
   * @param {string=} options.baseUrl Public base URL of this application
   *     (scheme://host[:port]) — the part before {@code /services}. Falls back
   *     to {@code process.env.AZURE_AD_BASE_URL}. The fixed callback path
   *     ({@code /services/authservice/openid}) is appended to form the redirect URL.
   * @param {string=} options.callbackURL Fully-qualified redirect URL override.
   *     Falls back to {@code options.redirectUrl} then
   *     {@code process.env.AZURE_AD_REDIRECT_URL}; when none are set the URL is
   *     built from {@code baseUrl} + the fixed callback path.
   * @param {Object=} options.express-app Express app instance for passport setup.
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.logger = options.dependencies?.logging;

    this.settings = {};
    this.settings.desciption = 'This provider exposes the NooblyJS Azure AD (Entra ID) auth implementation settings';
    this.settings.list = [];

    this.passport_ = null;
    this.AzureStrategy_ = null;

    // Optional shared user store. When the host runs this provider ALONGSIDE
    // another provider (e.g. the file provider that owns the persisted users and
    // configured passport's serializers), the OIDC verify callback must create
    // and read users in THAT provider's store — otherwise the user is written to
    // this instance's in-memory Map while passport's deserializeUser (bound to the
    // other provider) can't find it, and the session never deserializes. When
    // provided, all user persistence is delegated to it; otherwise this instance
    // is its own store (the standalone case, e.g. tests/app/authservice/app-azure.js).
    this.userStore_ = options.userStore || null;

    // Resolve configuration: explicit options take precedence over AZURE_AD_* env vars.
    this.clientID_ = options.clientID || process.env.AZURE_AD_CLIENT_ID;
    this.clientSecret_ = options.clientSecret || process.env.AZURE_AD_SECRET;
    this.tenantID_ = options.tenantID || process.env.AZURE_AD_TENANT_ID;

    // The application path Azure redirects back to is fixed; only the host
    // (base URL) differs between environments and comes from AZURE_AD_BASE_URL.
    this.callbackPath_ = AZURE_CALLBACK_PATH;
    this.baseUrl_ = (options.baseUrl || process.env.AZURE_AD_BASE_URL || '').replace(/\/+$/, '');
    this.callbackURL_ = options.callbackURL
      || options.redirectUrl
      || process.env.AZURE_AD_REDIRECT_URL
      || (this.baseUrl_ + this.callbackPath_);

    this.initializePassport_();

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:provider-initialized', {
        provider: 'azure',
        message: 'Azure AD auth provider initialized'
      });
    }
  }

  /**
   * Get all our settings
   */
  async getSettings() {
    return this.settings;
  }

  /**
   * Set all our settings
   */
  async saveSettings(settings) {
    for (let i = 0; i < this.settings.list.length; i++) {
      if (settings[this.settings.list[i].setting] != null) {
        this.settings[this.settings.list[i].setting] = settings[this.settings.list[i].setting];
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
   * Builds the OpenID Connect identity metadata URL for the configured tenant.
   * @return {string} The well-known OpenID configuration endpoint.
   * @private
   */
  buildIdentityMetadata_() {
    const tenant = this.tenantID_ || 'common';
    return `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`;
  }

  /**
   * Initializes passport with the Azure AD OpenID Connect strategy.
   * @private
   */
  initializePassport_() {
    try {
      // Use the passport instance the host passes in (options.passport) when
      // present. This is REQUIRED when core is a separate package from the host:
      // each has its own node_modules/passport, so a bare require('passport')
      // here would register the OIDC strategy on core's singleton — invisible to
      // the host's app.use(passport.initialize()) / authenticate(). Falling back
      // to require('passport') keeps the standalone case working.
      this.passport_ = this.options_.passport || require('passport');
      const { OIDCStrategy } = requireOptional('passport-azure-ad', "authservice('azure')");
      this.AzureStrategy_ = OIDCStrategy;

      if (!this.clientID_ || !this.clientSecret_ || !this.tenantID_) {
        this.logger?.warn(`[${this.constructor.name}] Azure AD configuration missing`, {
          hasClientID: !!this.clientID_,
          hasClientSecret: !!this.clientSecret_,
          hasTenantID: !!this.tenantID_
        });
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('auth:azure-config-missing', {
            message: 'Azure AD client ID, client secret and tenant ID are required'
          });
        }
        return;
      }

      // Permit plain http redirect URLs for local development.
      const allowHttpForRedirectUrl = /^http:\/\//i.test(this.callbackURL_);

      // Configure Azure AD OpenID Connect strategy (authorization code flow).
      this.passport_.use(new this.AzureStrategy_(
        {
          identityMetadata: this.buildIdentityMetadata_(),
          clientID: this.clientID_,
          clientSecret: this.clientSecret_,
          responseType: 'code',
          responseMode: 'form_post',
          redirectUrl: this.callbackURL_,
          allowHttpForRedirectUrl,
          validateIssuer: false,
          passReqToCallback: false,
          // Sign-in only by default. A Microsoft Graph permission such as User.Read needs admin consent in some
          // tenants, and asking for it stops every sign-in at "Approval required" until an admin grants it. A host
          // that has that consent passes it in options.scope.
          scope: this.options_.scope || ['openid', 'profile', 'email'],
          // Opt-in verbose diagnostics for local debugging. Set
          // AZURE_AD_LOG_LEVEL=info (and optionally AZURE_AD_LOG_PII=true) to
          // see why the strategy accepts/rejects a request. Defaults keep the
          // library quiet in production.
          loggingLevel: this.options_.loggingLevel || process.env.AZURE_AD_LOG_LEVEL || 'warn',
          loggingNoPII: process.env.AZURE_AD_LOG_PII === 'true' ? false : true
        },
        async (iss, sub, profile, accessToken, refreshToken, done) => {
          try {
            const result = await this.handleAzureAuth_(profile, accessToken, refreshToken);
            return done(null, result.user, { session: result.session, redirectUrl: result.redirectUrl });
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
      this.logger?.warn(`[${this.constructor.name}] passport-azure-ad unavailable`, {
        error: error.message
      });
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:azure-unavailable', {
          message: 'passport-azure-ad package not installed',
          error: error.message
        });
      }
    }
  }

  /**
   * Extracts the user's email address from an Azure AD profile.
   * Azure AD exposes the email under varying claims depending on the account
   * type (work/school vs. personal Microsoft account), so several locations
   * are checked in order of preference.
   * @param {Object} profile Azure AD profile object.
   * @return {?string} The resolved email address, or null if unavailable.
   * @private
   */
  extractEmail_(profile) {
    if (!profile) {
      return null;
    }
    return (profile._json && (profile._json.preferred_username || profile._json.email))
      || (Array.isArray(profile.emails) && profile.emails[0] && (profile.emails[0].value || profile.emails[0]))
      || profile.upn
      || null;
  }

  /**
   * Handles Azure AD authentication result.
   * @param {Object} profile Azure AD profile object.
   * @param {string} accessToken OAuth access token.
   * @param {string} refreshToken OAuth refresh token.
   * @param {string=} returnUrl Optional return URL for post-login redirect.
   * @return {Promise<Object>} Promise resolving to authentication result.
   * @throws {Error} When the profile does not contain an email address.
   * @private
   */
  async handleAzureAuth_(profile, accessToken, refreshToken, returnUrl) {
    const rawEmail = this.extractEmail_(profile);
    if (!rawEmail) {
      throw new Error('Azure AD profile did not contain an email address');
    }
    // Canonicalize the email to a lowercase key, exactly as the trusted-identity
    // endpoint used by Teams/Chrome (/api/auth/identity) does when it auto-provisions
    // a user. Azure can return mixed case in preferred_username/upn (e.g.
    // Jane.Doe@Company.com); keying on the raw value would create a SECOND account
    // for someone who already signed in via Teams/the extension/local login, and
    // their per-user storage (pins, activity, etc.) would diverge. One canonical
    // identity per person, regardless of entry point.
    const email = rawEmail.toLowerCase().trim();
    const fullName = profile.displayName
      || (profile._json && profile._json.name)
      || email; // Use Azure AD display name as full name
    const azureId = profile.oid || (profile._json && profile._json.oid) || profile.sub || profile.id;

    // Persist into the shared store when one was injected (so the user is visible
    // to passport's deserializeUser, which is bound to that provider); otherwise
    // this instance is the store.
    const store = this.userStore_ || this;

    let user;
    try {
      // Try to get existing user (identified by email)
      user = await store.getUser(email);
    } catch (error) {
      // User doesn't exist, create new one
      user = await store.createUser({
        email,
        fullName,
        password: store.generateStrongPassword(), // Random strong password for OAuth users
        role: 'user'
      });
    }

    // Update user with Azure AD-specific data
    await store.updateUser(email, {
      fullName,
      azureId,
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
      provider: 'azure',
      createdAt: new Date(),
      lastActivityAt: Date.now(),
      expiresAt: new Date(Date.now() + this.sessionConfig_().absoluteTimeoutMs)
    };

    this.sessions_.set(sessionToken, session);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:azure-login', {
        email,
        roles: userRoles
      });
    }

    // Where to go next: the page they were heading to > the app's loginSuccessRedirectUrl. Left null
    // when neither is set, so the caller picks its own default.
    const redirectUrl = postLoginRedirect(returnUrl, this.options_, null);

    return {
      user: store.getSafeUser_(user),
      session: { token: sessionToken, expiresAt: session.expiresAt },
      redirectUrl: redirectUrl
    };
  }

  /**
   * Sanitizes a post-login return URL to a safe same-origin relative path.
   * Accepts only values that start with a single '/' (an absolute path on this
   * origin); rejects protocol-relative ('//host'), backslash-smuggled ('/\\host')
   * and absolute ('http://…') URLs that could redirect off-site.
   * @param {*} url Candidate return URL (typically from a query string).
   * @return {?string} The URL if safe, otherwise null.
   * @private
   */
  sanitizeReturnUrl_(url) {
    return safeReturnUrl(url);
  }

  /**
   * Initiates the Azure AD OpenID Connect flow.
   * @param {Object} req Express request object.
   * @param {Object} res Express response object.
   * @param {Function} next Express next function.
   */
  initiateAzureAuth(req, res, next) {
    if (!this.passport_) {
      throw new Error('Azure AD authentication not available');
    }

    // Store the (sanitized) returnUrl in session for use in the callback.
    const safeReturnUrl = this.sanitizeReturnUrl_(req.query.returnUrl);
    if (safeReturnUrl) {
      req.session = req.session || {};
      req.session.oauthReturnUrl = safeReturnUrl;
    }

    this.passport_.authenticate(AZURE_STRATEGY_NAME, {
      // ?local=1 makes the login page show its credential form instead of
      // auto-bouncing back into SSO — so a failed initiate can't loop.
      failureRedirect: '/services/authservice/views/login.html?local=1'
    })(req, res, next);
  }

  /**
   * Handles the Azure AD OpenID Connect callback.
   * @param {Object} req Express request object.
   * @param {Object} res Express response object.
   * @param {Function} next Express next function.
   * @return {Promise<Object>} Promise resolving to authentication result.
   */
  async handleAzureCallback(req, res, next) {
    if (!this.passport_) {
      throw new Error('Azure AD authentication not available');
    }

    // Retrieve returnUrl from session, sanitized to a same-origin relative path
    // so a crafted ?returnUrl= cannot turn the post-login redirect into an open
    // redirect to an external site.
    const returnUrl = this.sanitizeReturnUrl_(req.session?.oauthReturnUrl);

    // Azure reports authorization errors by POSTing (or querying) error and
    // error_description to the redirect URI. error_description carries the real
    // AADSTS reason, which passport-azure-ad otherwise reduces to a bare code.
    const oauthError = req.body?.error || req.query?.error;
    const oauthErrorDescription = req.body?.error_description || req.query?.error_description;
    if (oauthError) {
      this.logger?.error(`[${this.constructor.name}] Azure returned an authorization error`, {
        error: oauthError,
        error_description: oauthErrorDescription
      });
    }

    return new Promise((resolve, reject) => {
      this.passport_.authenticate(AZURE_STRATEGY_NAME, (err, user, info) => {
        if (err) {
          // passport-azure-ad surfaces validation failures (state/nonce
          // mismatch, token errors, etc.) here. Log and propagate the detail.
          this.logger?.error(`[${this.constructor.name}] Azure AD callback error`, {
            error: err.message || String(err),
            error_description: oauthErrorDescription
          });
          return reject(err);
        }
        if (!user) {
          // No user means the strategy failed. Prefer Azure's error_description
          // (the AADSTS reason) over the bare OAuth code or passport's challenge.
          const reason = oauthErrorDescription
            || (oauthError ? `Azure AD error: ${oauthError}` : null)
            || (info && (info.message || info.reason))
            || 'Azure AD authentication failed (no user returned — likely a state/nonce '
               + 'or session-cookie problem on the form_post callback)';
          this.logger?.error(`[${this.constructor.name}] Azure AD callback rejected`, {
            reason,
            error: oauthError,
            info: info ? JSON.stringify(info) : undefined
          });
          return reject(new Error(reason));
        }

        req.logIn(user, (loginErr) => {
          if (loginErr) {
            return reject(loginErr);
          }
          // Pass returnUrl to the response
          const result = { user, session: info && info.session };
          if (info && info.redirectUrl) {
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
   * Middleware for protecting routes with Azure AD authentication.
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
   * Gets service status with Azure AD-specific information.
   * @return {Promise<Object>} Promise resolving to status object.
   */
  async getStatus() {
    const baseStatus = await super.getStatus();
    return {
      ...baseStatus,
      provider: 'azure',
      passportAvailable: !!this.passport_,
      strategy: 'azure-ad-openidconnect',
      tenantConfigured: !!this.tenantID_,
      configured: !!(this.clientID_ && this.clientSecret_ && this.tenantID_)
    };
  }
}

module.exports = AuthAzure;
