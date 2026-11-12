/**
 * @fileoverview Base Authentication Provider
 * Base class for authentication providers with user management and role-based access.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ClientError } = require('../../shared/utils/httpErrors');

/**
 * Supported onboarding modes (feature 16). `admin-approval` is the default.
 * @const {!Array<string>}
 */
const INVITATION_MODES = ['admin-approval', 'admin-only', 'domain-allowlist', 'open'];

/**
 * bcrypt cost factor used for password hashing. Defaults to 12; override via
 * the BCRYPT_COST environment variable (e.g. lower it in test environments to
 * keep suites fast).
 * @const {number}
 */
const BCRYPT_COST = parseInt(process.env.BCRYPT_COST, 10) || 12;

/**
 * Base authentication provider class with common functionality.
 * Provides user management, role-based access, and session handling.
 * @class
 */
class AuthBase {
  /**
   * Initializes the authentication provider.
   * @param {Object=} options Configuration options.
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {
    /** @protected @const {!Map<string, Object>} */
    this.users_ = new Map();
    /** @protected @const {!Map<string, Object>} */
    this.sessions_ = new Map();
    /** @protected @const {!Map<string, Array<string>>} */
    this.roles_ = new Map();
    /**
     * Index of hashed API token -> owner, for O(1) token validation instead of
     * scanning every user on each request. Built lazily on first validation and
     * maintained incrementally on create/delete.
     * @protected {!Map<string, {email: string, tokenId: string}>}
     */
    this.tokenIndex_ = new Map();
    /** @protected {boolean} Whether tokenIndex_ has been fully built. */
    this.tokenIndexBuilt_ = false;
    /** @protected {number} Epoch ms of the last throttled token-usage persist. */
    this.lastTokenUsagePersistAt_ = 0;
    this.eventEmitter_ = eventEmitter;
    this.options_ = options;

    // Initialize default roles
    this.roles_.set('admin', []);
    this.roles_.set('user', []);
    this.roles_.set('guest', []);

    this.getAuthStrategy = this.getAuthStrategy.bind(this);

    // Feature 16: fail fast on a typo in invitations.mode, and make `open`
    // mode impossible to miss in production.
    const { mode } = this.invitationConfig_();
    if (mode === 'open' && process.env.NODE_ENV === 'production') {
      process.emitWarning(
        'invitations.mode is "open": anyone can create an account. Use admin-approval, admin-only or domain-allowlist in production.',
        { code: 'NOOBLYJS_OPEN_INVITATIONS' }
      );
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:invitation-open-mode-warning', { mode });
      }
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
   * Creates a new user account.
   * @param {Object} userData User data object.
   * @param {string} userData.email User email address (serves as the unique identity).
   * @param {string} userData.fullName User's full display name.
   * @param {string} userData.password User password (will be hashed).
   * @param {string=} userData.role User role (default: 'user').
   * @return {Promise<Object>} Promise resolving to user object.
   * @throws {Error} When userData is invalid or the email already exists.
   */
  async createUser(userData) {
    // Validate userData parameter
    if (!userData || typeof userData !== 'object' || Array.isArray(userData)) {
      const error = new Error('Invalid userData: must be a non-null object');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'createUser',
          error: error.message
        });
      }
      throw error;
    }

    const { email, fullName, password, role = 'user' } = userData;

    // Validate email (also serves as the unique account identity)
    if (!email || typeof email !== 'string' || email.trim() === '') {
      const error = new Error('Invalid email: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'createUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    // Validate fullName
    if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
      const error = new Error('Invalid fullName: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'createUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    // Validate password
    if (!password || typeof password !== 'string' || password.trim() === '') {
      const error = new Error('Invalid password: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'createUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    // Validate password strength
    const strength = await this.validatePasswordStrength(password);
    if (!strength.valid) {
      const error = new Error('Password does not meet strength requirements: ' + strength.errors.join(', '));
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'createUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    if (this.users_.has(email)) {
      throw new Error('Email already exists');
    }

    // Support both single role and multiple roles
    const roles = Array.isArray(role) ? role : [role];

    const user = {
      id: this.generateId_(),
      email,
      fullName,
      password: await this.hashPassword_(password),
      roles,
      createdAt: new Date(),
      lastLogin: null,
      isActive: true
    };

    this.users_.set(email, user);
    roles.forEach(r => this.addUserToRole_(email, r));

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:user-created', { email, fullName, roles });
    }

    // Return user without password
    const { password: _, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Authenticates a user with email and password.
   * @param {string} email User email address.
   * @param {string} password Password.
   * @return {Promise<Object>} Promise resolving to user object if authenticated.
   * @throws {Error} When email or password is invalid, or credentials are incorrect.
   */
  async authenticateUser(email, password) {
    // Validate email parameter
    if (!email || typeof email !== 'string' || email.trim() === '') {
      const error = new Error('Invalid email: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'authenticateUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    // Validate password parameter
    if (!password || typeof password !== 'string') {
      const error = new Error('Invalid password: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'authenticateUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    const user = this.users_.get(email);

    if (!user || !user.isActive) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:login-failed', { email });
      }
      throw new Error('Invalid credentials');
    }

    const isValid = await this.verifyPassword_(password, user.password);
    if (!isValid) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:login-failed', { email });
      }
      throw new Error('Invalid credentials');
    }

    // Transparently upgrade legacy password hashes to bcrypt on login.
    if (this.needsRehash_(user.password)) {
      try {
        user.password = await this.hashPassword_(password);
        if (typeof this.saveUsersToFile_ === 'function') {
          await this.saveUsersToFile_();
        }
      } catch (err) {
        this.logger?.warn?.(`[${this.constructor.name}] Password rehash failed`, {
          email,
          error: err?.message
        });
      }
    }

    // Update last login
    user.lastLogin = new Date();

    // Create session
    const sessionToken = this.generateSessionToken_();
    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
    const session = {
      token: sessionToken,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: userRoles,
      createdAt: new Date(),
      lastActivityAt: Date.now(),
      expiresAt: new Date(Date.now() + this.sessionConfig_().absoluteTimeoutMs)
    };

    this.sessions_.set(sessionToken, session);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:login', { email, roles: userRoles });
    }

    return {
      user: this.getSafeUser_(user),
      session: { token: sessionToken, expiresAt: session.expiresAt }
    };
  }

  /**
   * Validates a session token.
   * @param {string} token Session token.
   * @return {Promise<Object>} Promise resolving to session object if valid.
   * @throws {Error} When token is invalid or session is expired.
   */
  async validateSession(token) {
    // Validate token parameter
    if (!token || typeof token !== 'string' || token.trim() === '') {
      const error = new Error('Invalid token: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'validateSession',
          error: error.message
        });
      }
      throw error;
    }

    const session = this.sessions_.get(token);

    if (!session) {
      throw new Error('Invalid session');
    }

    if (session.expiresAt < new Date()) {
      this.sessions_.delete(token);
      throw new Error('Session expired');
    }

    // Feature 23: idle timeout (shorter for admins) next to the absolute
    // lifetime. Each successful validation counts as activity.
    const idleMs = this.idleTimeoutFor(session.roles);
    const now = Date.now();
    if (idleMs > 0 && session.lastActivityAt && now - session.lastActivityAt > idleMs) {
      this.sessions_.delete(token);
      this.eventEmitter_?.emit('auth:session-idle-expired', { email: session.email });
      throw new Error('Session expired');
    }
    session.lastActivityAt = now;

    return session;
  }

  /**
   * Session lifetime settings (feature 23), from `options.session`.
   * @return {{idleTimeoutMs: number, adminIdleTimeoutMs: number, absoluteTimeoutMs: number}}
   */
  sessionConfig_() {
    const cfg = (this.options_ && this.options_.session) || {};
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
    return {
      idleTimeoutMs: num(cfg.idleTimeoutMs, 8 * 60 * 60 * 1000),
      adminIdleTimeoutMs: num(cfg.adminIdleTimeoutMs, 30 * 60 * 1000),
      absoluteTimeoutMs: num(cfg.absoluteTimeoutMs, 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000
    };
  }

  /**
   * Idle timeout for a set of roles: the admin timeout when the user is an
   * admin, otherwise the general one. 0 disables the idle check.
   * @param {Array<string>=} roles Session roles.
   * @return {number} Milliseconds.
   */
  idleTimeoutFor(roles) {
    const cfg = this.sessionConfig_();
    return Array.isArray(roles) && roles.includes('admin') ? cfg.adminIdleTimeoutMs : cfg.idleTimeoutMs;
  }

  /**
   * Ends every session a user holds and records the time, so cookie
   * (Passport) sessions established earlier are refused too. Called on
   * password and role changes (feature 23).
   * @param {string} email User email.
   * @param {string} reason Why, for the event.
   * @return {number} Number of token sessions removed.
   */
  revokeUserSessions(email, reason) {
    let removed = 0;
    for (const [token, session] of this.sessions_.entries()) {
      if (session.email === email) {
        this.sessions_.delete(token);
        removed += 1;
      }
    }
    const user = this.users_.get(email);
    if (user) user.sessionsValidAfter = Date.now();
    this.eventEmitter_?.emit('auth:sessions-revoked', { email, reason, removed });
    return removed;
  }

  /**
   * Logs out a user by invalidating their session.
   * @param {string} token Session token.
   * @return {Promise<void>} Promise resolving when logged out.
   */
  async logout(token) {
    const session = this.sessions_.get(token);
    if (session) {
      this.sessions_.delete(token);
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:logout', { email: session.email });
      }
    }
  }

  /**
   * Gets user by email.
   * @param {string} email User email address.
   * @return {Promise<Object>} Promise resolving to user object.
   */
  async getUser(email) {
    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }
    return this.getSafeUser_(user);
  }

  /**
   * Updates user information.
   * @param {string} email User email address.
   * @param {Object} updates Object containing fields to update.
   * @return {Promise<Object>} Promise resolving to updated user object.
   * @throws {Error} When email or updates is invalid, or user not found.
   */
  async updateUser(email, updates) {
    // Validate email parameter
    if (!email || typeof email !== 'string' || email.trim() === '') {
      const error = new Error('Invalid email: must be a non-empty string');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'updateUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    // Validate updates parameter
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      const error = new Error('Invalid updates: must be a non-null object');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'updateUser',
          error: error.message,
          email
        });
      }
      throw error;
    }

    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }

    // Don't allow updating email (the identity) or id
    const { email: _, id: __, ...allowedUpdates } = updates;

    // Hash password if being updated
    if (allowedUpdates.password) {
      // Validate password strength
      const strength = await this.validatePasswordStrength(allowedUpdates.password);
      if (!strength.valid) {
        const error = new Error('Password does not meet strength requirements: ' + strength.errors.join(', '));
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('auth:validation-error', {
            method: 'updateUser',
            error: error.message,
            email
          });
        }
        throw error;
      }
      allowedUpdates.password = await this.hashPassword_(allowedUpdates.password);
    }

    const before = JSON.stringify([user.role, user.roles, user.isActive]);
    Object.assign(user, allowedUpdates);

    // Feature 23: a new password, role or deactivation ends existing sessions.
    if (allowedUpdates.password) {
      this.revokeUserSessions(email, 'password-changed');
    } else if (JSON.stringify([user.role, user.roles, user.isActive]) !== before) {
      this.revokeUserSessions(email, 'role-changed');
    }

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:user-updated', { email, updates: Object.keys(allowedUpdates) });
    }

    return this.getSafeUser_(user);
  }

  /**
   * Deletes a user.
   * @param {string} email User email address.
   * @return {Promise<void>} Promise resolving when user is deleted.
   */
  async deleteUser(email) {
    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }

    this.users_.delete(email);
    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || ''];
    userRoles.forEach(role => this.removeUserFromRole_(email, role));

    // Invalidate all sessions for this user
    for (const [token, session] of this.sessions_.entries()) {
      if (session.email === email) {
        this.sessions_.delete(token);
      }
    }

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:user-deleted', { email });
    }
  }

  /**
   * Lists all users.
   * @return {Promise<Array<Object>>} Promise resolving to array of user objects.
   */
  async listUsers() {
    return Array.from(this.users_.values()).map(user => this.getSafeUser_(user));
  }

  /**
   * Adds a user to a role.
   * @param {string} email User email address.
   * @param {string} role Role name.
   * @return {Promise<void>} Promise resolving when user is added to role.
   */
  async addUserToRole(email, role) {
    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }

    this.addUserToRole_(email, role);
    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
    if (!userRoles.includes(role)) {
      userRoles.push(role);
      user.roles = userRoles;
      this.revokeUserSessions(email, 'role-changed');
    }

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:role-assigned', { email, role });
    }
  }

  /**
   * Gets users in a specific role.
   * @param {string} role Role name.
   * @return {Promise<Array<Object>>} Promise resolving to array of user objects.
   */
  async getUsersInRole(role) {
    const emails = this.roles_.get(role) || [];
    return emails.map(email => this.getSafeUser_(this.users_.get(email))).filter(Boolean);
  }

  /**
   * Lists all roles.
   * @return {Promise<Array<string>>} Promise resolving to array of role names.
   */
  async listRoles() {
    return Array.from(this.roles_.keys());
  }

  /**
   * Creates a new role.
   * @param {string} roleName Role name.
   * @return {Promise<string>} Promise resolving to the new role name.
   * @throws {Error} When role name is invalid or already exists.
   */
  async createRole(roleName) {
    if (!roleName || typeof roleName !== 'string' || roleName.trim() === '') {
      throw new Error('Role name must be a non-empty string');
    }

    if (this.roles_.has(roleName)) {
      throw new Error('Role already exists');
    }

    this.roles_.set(roleName, []);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:role-created', { roleName });
    }

    return roleName;
  }

  /**
   * Deletes a role.
   * @param {string} roleName Role name.
   * @return {Promise<void>} Promise resolving when role is deleted.
   * @throws {Error} When role not found or users still assigned.
   */
  async deleteRole(roleName) {
    if (!this.roles_.has(roleName)) {
      throw new Error('Role not found');
    }

    const users = this.roles_.get(roleName);
    if (users && users.length > 0) {
      throw new Error('Cannot delete role with assigned users. Reassign users first.');
    }

    this.roles_.delete(roleName);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:role-deleted', { roleName });
    }
  }

  /**
   * Batch creates or updates users from an array.
   * @param {Array<Object>} usersArray Array of user objects to create/update.
   * @return {Promise<Object>} Promise resolving to { created: [], updated: [], errors: [] }.
   */
  async batchCreateUpdateUsers(usersArray) {
    const results = {
      created: [],
      updated: [],
      errors: []
    };

    if (!Array.isArray(usersArray)) {
      throw new Error('Users array must be an array');
    }

    for (let i = 0; i < usersArray.length; i++) {
      try {
        const userData = usersArray[i];

        if (this.users_.has(userData.email)) {
          // Update existing user
          const updated = await this.updateUser(userData.email, userData);
          results.updated.push(updated);
        } else {
          // Create new user
          const created = await this.createUser(userData);
          results.created.push(created);
        }
      } catch (error) {
        results.errors.push({
          row: i + 1,
          email: usersArray[i].email,
          error: error.message
        });
      }
    }

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:batch-import', {
        created: results.created.length,
        updated: results.updated.length,
        errors: results.errors.length
      });
    }

    return results;
  }

  /**
   * Changes a user's password.
   * @param {string} email User email address.
   * @param {string} currentPassword Current password (for verification).
   * @param {string} newPassword New password.
   * @return {Promise<Object>} Promise resolving to updated user object.
   * @throws {Error} When credentials are invalid or password is weak.
   */
  async changePassword(email, currentPassword, newPassword) {
    if (!email || !currentPassword || !newPassword) {
      throw new Error('Email, current password, and new password are required');
    }

    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }

    const isValid = await this.verifyPassword_(currentPassword, user.password);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    const strength = await this.validatePasswordStrength(newPassword);
    if (!strength.valid) {
      throw new Error('New password does not meet strength requirements: ' + strength.errors.join(', '));
    }

    user.password = await this.hashPassword_(newPassword);
    this.revokeUserSessions(email, 'password-changed');

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:password-changed', { email });
    }

    return this.getSafeUser_(user);
  }

  /**
   * Prefix carried by every issued personal access token. It is part of the
   * secret (and therefore part of what is hashed at rest) so that the auth
   * middleware can cheaply recognise a user token versus a static API key, and
   * so leaked tokens are greppable in logs and secret-scanners.
   * @const {string}
   */
  static get TOKEN_PREFIX() {
    return 'dtk_';
  }

  /**
   * Returns a display-safe view of a stored token (never the hashed secret).
   * @param {Object} t Stored token record.
   * @return {Object} Token metadata safe to return to callers.
   * @protected
   */
  getSafeToken_(t) {
    return {
      id: t.id,
      name: t.name,
      tokenPrefix: t.tokenPrefix,
      createdAt: t.createdAt,
      lastUsed: t.lastUsed,
      expiresAt: t.expiresAt,
      scopes: Array.isArray(t.scopes) ? t.scopes.slice() : null
    };
  }

  /**
   * (Re)builds the hashed-token -> owner index from the in-memory user map.
   * Called lazily on first validation so it picks up tokens loaded from disk.
   * @protected
   */
  buildTokenIndex_() {
    const index = new Map();
    for (const [email, user] of this.users_.entries()) {
      const tokens = Array.isArray(user.apiTokens) ? user.apiTokens : [];
      for (const t of tokens) {
        if (t && t.token) {
          index.set(t.token, { email, tokenId: t.id });
        }
      }
    }
    this.tokenIndex_ = index;
    this.tokenIndexBuilt_ = true;
  }

  /**
   * Persists token usage (lastUsed) at most once per minute. lastUsed is
   * telemetry, not security state, so writes are throttled and fire-and-forget
   * to avoid an I/O storm on hot API paths. No-op when the provider has no
   * file persistence.
   * @protected
   */
  persistTokenUsageThrottled_() {
    if (typeof this.saveUsersToFile_ !== 'function') {
      return;
    }
    const now = Date.now();
    if (this.lastTokenUsagePersistAt_ && (now - this.lastTokenUsagePersistAt_) < 60000) {
      return;
    }
    this.lastTokenUsagePersistAt_ = now;
    Promise.resolve()
      .then(() => this.saveUsersToFile_())
      .catch(() => { /* telemetry only — ignore persistence failures */ });
  }

  /**
   * Creates an API (personal access) token for a user. The raw secret is
   * returned exactly once; only its SHA-256 hash is stored.
   * @param {string} email User email address.
   * @param {string} tokenName Token name/label.
   * @param {Object=} options Token options.
   * @param {number=} options.expiresInDays Days until the token expires (omit for no expiry).
   * @param {(string|Date)=} options.expiresAt Explicit expiry timestamp (overrides expiresInDays).
   * @return {Promise<Object>} Promise resolving to { id, token, tokenPrefix, name, createdAt, expiresAt }.
   * @throws {Error} When email/tokenName are missing or the user does not exist.
   */
  async createApiToken(email, tokenName, options = {}) {
    if (!email || !tokenName) {
      throw new Error('Email and token name are required');
    }

    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.apiTokens) {
      user.apiTokens = [];
    }

    const tokenId = 'tok_' + crypto.randomBytes(9).toString('hex');
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const wireToken = AuthBase.TOKEN_PREFIX + rawSecret;
    const hashedToken = crypto.createHash('sha256').update(wireToken).digest('hex');
    const tokenPrefix = wireToken.substring(0, 12); // 'dtk_' + first 8 hex chars

    let expiresAt = null;
    if (options.expiresAt) {
      const parsed = new Date(options.expiresAt);
      if (!Number.isNaN(parsed.getTime())) {
        expiresAt = parsed;
      }
    } else if (options.expiresInDays != null && Number(options.expiresInDays) > 0) {
      expiresAt = new Date(Date.now() + Number(options.expiresInDays) * 24 * 60 * 60 * 1000);
    }
    // Feature 23: tokens expire by default (tokens.defaultExpiryDays, 90).
    // A token with no expiry needs tokens.allowNonExpiring: true.
    const tokenCfg = (this.options_ && this.options_.tokens) || {};
    const maxDays = Number(tokenCfg.maxExpiryDays) > 0 ? Number(tokenCfg.maxExpiryDays) : 0;
    if (!expiresAt && !(tokenCfg.allowNonExpiring === true && options.expiresInDays === 0)) {
      const days = Number(tokenCfg.defaultExpiryDays) > 0 ? Number(tokenCfg.defaultExpiryDays) : 90;
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    if (expiresAt && maxDays && expiresAt.getTime() > Date.now() + maxDays * 24 * 60 * 60 * 1000) {
      throw new Error(`Token expiry cannot be more than ${maxDays} days away`);
    }

    // Feature 19: an optional list of permissions narrows what the token can
    // do; it never adds to the owner's own permissions.
    let scopes = null;
    if (options.scopes !== undefined && options.scopes !== null) {
      const list = Array.isArray(options.scopes) ? options.scopes : String(options.scopes).split(',');
      scopes = list.map((sc) => String(sc).trim()).filter(Boolean);
      if (scopes.length === 0 || scopes.length > 50
        || scopes.some((sc) => sc.length > 100 || !/^(\*|[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9-]*))$/.test(sc))) {
        throw new Error('Token scopes must be permissions such as "filing:read" or "filing:*"');
      }
    }

    const token = {
      id: tokenId,
      name: tokenName,
      token: hashedToken,
      tokenPrefix: tokenPrefix,
      createdAt: new Date(),
      lastUsed: null,
      expiresAt: expiresAt,
      scopes
    };

    user.apiTokens.push(token);

    // Keep the validation index current when it has already been built.
    if (this.tokenIndexBuilt_ && this.tokenIndex_) {
      this.tokenIndex_.set(hashedToken, { email, tokenId });
    }

    // Persist immediately so tokens survive a restart (file provider). Other
    // providers without saveUsersToFile_ keep tokens in memory only.
    if (typeof this.saveUsersToFile_ === 'function') {
      await this.saveUsersToFile_();
    }

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:api-token-created', { email, tokenName });
    }

    return {
      id: token.id,
      token: wireToken,
      tokenPrefix: token.tokenPrefix,
      name: token.name,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      scopes: token.scopes
    };
  }

  /**
   * Lists API tokens for a user.
   * @param {string} email User email address.
   * @return {Promise<Array<Object>>} Promise resolving to array of tokens (without secret).
   */
  async listApiTokens(email) {
    if (!email) {
      throw new Error('Email is required');
    }

    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }

    return (user.apiTokens || []).map(t => this.getSafeToken_(t));
  }

  /**
   * Deletes (revokes) an API token for a user.
   * @param {string} email User email address.
   * @param {string} tokenId Token ID.
   * @return {Promise<void>} Promise resolving when token is deleted.
   */
  async deleteApiToken(email, tokenId) {
    if (!email || !tokenId) {
      throw new Error('Email and token ID are required');
    }

    const user = this.users_.get(email);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.apiTokens) {
      throw new Error('Token not found');
    }

    const index = user.apiTokens.findIndex(t => t.id === tokenId);
    if (index === -1) {
      throw new Error('Token not found');
    }

    const [removed] = user.apiTokens.splice(index, 1);

    if (this.tokenIndex_ && removed && removed.token) {
      this.tokenIndex_.delete(removed.token);
    }

    if (typeof this.saveUsersToFile_ === 'function') {
      await this.saveUsersToFile_();
    }

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:api-token-deleted', { email, tokenId });
    }
  }

  /**
   * Validates a presented API token and returns the resolved identity. Roles
   * are resolved live from the owning user so that revoking a role or
   * deactivating an account immediately de-powers every token they issued.
   * Enforces expiry and active-account status, and records last-used.
   * @param {string} tokenValue The raw token value as presented by the caller.
   * @return {Promise<{email: string, roles: Array<string>, user: Object, token: Object}>}
   *     Resolves to the owner identity when the token is valid.
   * @throws {Error} When the token is missing, unknown, expired, or the owner is inactive.
   */
  async validateApiToken(tokenValue) {
    if (!tokenValue) {
      throw new Error('Token is required');
    }

    const hashedToken = crypto.createHash('sha256').update(tokenValue).digest('hex');

    if (!this.tokenIndexBuilt_) {
      this.buildTokenIndex_();
    }

    const entry = this.tokenIndex_.get(hashedToken);
    if (!entry) {
      throw new Error('Invalid API token');
    }

    const user = this.users_.get(entry.email);
    if (!user) {
      this.tokenIndex_.delete(hashedToken);
      throw new Error('Invalid API token');
    }

    const token = (user.apiTokens || []).find(t => t.id === entry.tokenId);
    if (!token) {
      this.tokenIndex_.delete(hashedToken);
      throw new Error('Invalid API token');
    }

    if (user.isActive === false) {
      throw new Error('User account is inactive');
    }

    if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
      throw new Error('API token expired');
    }

    token.lastUsed = new Date();
    this.persistTokenUsageThrottled_();

    const roles = Array.isArray(user.roles)
      ? user.roles
      : (user.role ? [user.role] : ['user']);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:api-token-used', { email: user.email, tokenId: token.id });
    }

    return {
      email: user.email,
      roles,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles,
        isActive: user.isActive !== false
      },
      token: this.getSafeToken_(token)
    };
  }

  // ---------------------------------------------------------------------
  // Invitations (feature 16)
  //
  // Modes (`options.invitations.mode`, or INVITATION_MODE):
  //   admin-approval (default) — a public request creates a *pending*
  //       invitation; an admin approves it and receives (or emails) the code.
  //   admin-only — no public requests; admins create invitations.
  //   domain-allowlist — requests from `allowedDomains` are approved and the
  //       code is sent through `sendCode`; others stay pending.
  //   open — legacy behaviour: the code is returned to the requester. Demos only.
  //
  // Codes are never stored: only a SHA-256 hash is kept, so a leaked data file
  // or an admin listing cannot be used to redeem. The plaintext code is
  // returned exactly once, to whoever is entitled to it (the admin who created,
  // approved or recreated it; the requester only in `open` mode).
  // ---------------------------------------------------------------------

  /**
   * Returns the invitation configuration with defaults applied.
   * @return {{mode: string, allowedDomains: !Array<string>, ttlMs: number,
   *     sendCode: ?Function}}
   * @protected
   */
  invitationConfig_() {
    const cfg = (this.options_ && this.options_.invitations) || {};
    const mode = cfg.mode || process.env.INVITATION_MODE || 'admin-approval';
    if (!INVITATION_MODES.includes(mode)) {
      throw new Error(`Unknown invitations.mode "${mode}". Use one of: ${INVITATION_MODES.join(', ')}`);
    }
    const allowedDomains = (Array.isArray(cfg.allowedDomains)
      ? cfg.allowedDomains
      : String(cfg.allowedDomains || process.env.INVITATION_ALLOWED_DOMAINS || '').split(','))
      .map((d) => String(d).trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
    const ttlDays = Number(cfg.ttlDays) > 0 ? Number(cfg.ttlDays) : 7;
    return {
      mode,
      allowedDomains,
      ttlMs: ttlDays * 24 * 60 * 60 * 1000,
      sendCode: typeof cfg.sendCode === 'function' ? cfg.sendCode : null
    };
  }

  /**
   * Lazily creates the invitation store.
   * @return {!Map<string, Object>} id -> invitation record
   * @protected
   */
  invitationStore_() {
    if (!this.invitations_) {
      this.invitations_ = new Map();
    }
    return this.invitations_;
  }

  /**
   * Persists invitations. The base class keeps them in memory; persistent
   * providers (file) override this.
   * @return {Promise<void>}
   * @protected
   */
  async persistInvitations_() {}

  /**
   * Hashes an invitation code for storage and lookup.
   * @param {string} code Plaintext code.
   * @return {string} Hex SHA-256 digest.
   * @protected
   */
  hashInvitationCode_(code) {
    return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
  }

  /**
   * Gives an invitation a fresh code and expiry. Any previous code stops working.
   * @param {!Object} invitation Invitation record (mutated).
   * @return {string} The plaintext code, to be shown or sent once.
   * @protected
   */
  issueInvitationCode_(invitation) {
    const code = 'INV-' + crypto.randomBytes(10).toString('hex').toUpperCase();
    invitation.codeHash = this.hashInvitationCode_(code);
    invitation.codeHint = code.slice(-4);
    invitation.status = 'approved';
    invitation.approvedAt = new Date();
    invitation.expiresAt = new Date(Date.now() + this.invitationConfig_().ttlMs);
    return code;
  }

  /**
   * Finds an invitation by its plaintext code (constant-time hash compare).
   * @param {string} code Plaintext code.
   * @return {?Object} The invitation record, or null.
   * @protected
   */
  findInvitationByCode_(code) {
    if (typeof code !== 'string' || !code || code.length > 200) return null;
    const wanted = Buffer.from(this.hashInvitationCode_(code), 'hex');
    let found = null;
    for (const invitation of this.invitationStore_().values()) {
      if (!invitation.codeHash) continue;
      const have = Buffer.from(invitation.codeHash, 'hex');
      if (have.length === wanted.length && crypto.timingSafeEqual(have, wanted)) {
        found = invitation;
      }
    }
    return found;
  }

  /**
   * Finds an invitation by id, falling back to its code.
   * @param {string} idOrCode Invitation id or plaintext code.
   * @return {?Object} The invitation record, or null.
   * @protected
   */
  findInvitation_(idOrCode) {
    if (!idOrCode) return null;
    return this.invitationStore_().get(idOrCode) || this.findInvitationByCode_(idOrCode);
  }

  /**
   * Returns the fields of an invitation that are safe to show an admin.
   * @param {!Object} invitation Invitation record.
   * @param {string=} code Plaintext code to include (only right after issuing it).
   * @return {!Object}
   * @protected
   */
  publicInvitation_(invitation, code) {
    const view = {
      id: invitation.id,
      name: invitation.name,
      email: invitation.email,
      mobile: invitation.mobile || null,
      status: invitation.status,
      source: invitation.source,
      codeHint: invitation.codeHint || null,
      createdAt: invitation.createdAt,
      approvedAt: invitation.approvedAt || null,
      usedAt: invitation.usedAt || null,
      expiresAt: invitation.expiresAt || null
    };
    if (code) view.code = code;
    return view;
  }

  /**
   * Validates and normalises invitee details.
   * @param {Object} data Raw input.
   * @return {{name: string, email: string, mobile: ?string}}
   * @throws {Error} When name or email is missing or malformed.
   * @protected
   */
  normalizeInvitee_(data) {
    const { name, email, mobile } = data || {};
    if (!name || !email || typeof name !== 'string' || typeof email !== 'string') {
      throw new Error('Name and email are required');
    }
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('A valid email address is required');
    }
    const cleanName = name.trim().slice(0, 200);
    if (!cleanName) {
      throw new Error('Name and email are required');
    }
    return {
      name: cleanName,
      email: cleanEmail,
      mobile: typeof mobile === 'string' && mobile.trim() ? mobile.trim().slice(0, 40) : null
    };
  }

  /**
   * Creates and stores a new invitation record.
   * @param {{name: string, email: string, mobile: ?string}} invitee Invitee.
   * @param {string} source 'public' or 'admin'.
   * @return {!Object} The record (status 'pending').
   * @protected
   */
  newInvitation_(invitee, source) {
    const invitation = {
      id: crypto.randomUUID(),
      ...invitee,
      status: 'pending',
      source,
      codeHash: null,
      codeHint: null,
      createdAt: new Date(),
      approvedAt: null,
      usedAt: null,
      expiresAt: null
    };
    this.invitationStore_().set(invitation.id, invitation);
    return invitation;
  }

  /**
   * Sends a code through the configured transport, if there is one.
   * @param {!Object} invitation Invitation record.
   * @param {string} code Plaintext code.
   * @return {Promise<boolean>} Whether the code was handed to a transport.
   * @protected
   */
  async deliverInvitationCode_(invitation, code) {
    const { sendCode } = this.invitationConfig_();
    if (!sendCode) return false;
    try {
      await sendCode({ email: invitation.email, name: invitation.name, code, expiresAt: invitation.expiresAt });
      return true;
    } catch (error) {
      this.logger?.warn?.(`[${this.constructor.name}] Invitation code delivery failed`, {
        email: invitation.email,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Handles a *public* invitation request according to `invitations.mode`.
   * Except in `open` mode the response never contains a code.
   *
   * @param {Object} data Invitation request data.
   * @param {string} data.name Full name.
   * @param {string} data.email Email address.
   * @param {string=} data.mobile Mobile number.
   * @return {Promise<Object>} `{ email, name, status }` where status is
   *     'pending' or 'sent' (plus `code` and `expiresAt` in open mode).
   * @throws {ClientError} 403 in admin-only mode.
   */
  async requestInvitation(data) {
    const invitee = this.normalizeInvitee_(data);
    const config = this.invitationConfig_();

    if (config.mode === 'admin-only') {
      throw new ClientError(403, 'Invitations are created by an administrator');
    }

    // One live invitation per email: repeat requests get the same answer and
    // do not create (or email) anything new.
    const existing = Array.from(this.invitationStore_().values()).find((inv) =>
      inv.email === invitee.email
      && (inv.status === 'pending' || (inv.status === 'approved' && inv.expiresAt > new Date())));
    if (existing && config.mode !== 'open') {
      return {
        email: invitee.email,
        name: invitee.name,
        status: existing.status === 'approved' ? 'sent' : 'pending'
      };
    }

    const invitation = this.newInvitation_(invitee, 'public');
    let response = { email: invitee.email, name: invitee.name, status: 'pending' };

    if (config.mode === 'open') {
      const code = this.issueInvitationCode_(invitation);
      response = { code, email: invitee.email, name: invitee.name, status: 'approved', expiresAt: invitation.expiresAt };
    } else if (config.mode === 'domain-allowlist' && config.sendCode
      && config.allowedDomains.includes(invitee.email.split('@')[1])) {
      const code = this.issueInvitationCode_(invitation);
      if (await this.deliverInvitationCode_(invitation, code)) {
        response.status = 'sent';
      } else {
        // Could not prove ownership of the address: fall back to approval.
        invitation.status = 'pending';
        invitation.codeHash = null;
        invitation.codeHint = null;
        invitation.approvedAt = null;
        invitation.expiresAt = null;
      }
    }

    await this.persistInvitations_();
    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:invitation-requested', {
        id: invitation.id,
        email: invitee.email,
        status: invitation.status,
        mode: config.mode
      });
    }
    return response;
  }

  /**
   * Creates an approved invitation on behalf of an administrator (or trusted
   * application code) and returns its code once.
   *
   * @param {Object} data Invitee: `name`, `email`, optional `mobile`.
   * @param {Object=} context Optional `{ createdBy }` for the audit event.
   * @return {Promise<Object>} The invitation, including its plaintext `code`.
   */
  async createInvitation(data, context = {}) {
    const invitee = this.normalizeInvitee_(data);
    const invitation = this.newInvitation_(invitee, 'admin');
    const code = this.issueInvitationCode_(invitation);
    await this.persistInvitations_();
    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:invitation-created', {
        id: invitation.id,
        email: invitee.email,
        createdBy: context.createdBy || null
      });
    }
    return this.publicInvitation_(invitation, code);
  }

  /**
   * Approves a pending invitation. A code is issued, sent through the
   * configured transport if there is one, and returned to the approving admin.
   *
   * @param {string} idOrCode Invitation id (or code).
   * @param {Object=} context Optional `{ approvedBy }` for the audit event.
   * @return {Promise<Object>} The invitation, including its plaintext `code`
   *     and `delivered` (whether a transport sent it).
   */
  async approveInvitation(idOrCode, context = {}) {
    if (!idOrCode) {
      throw new Error('Invitation id is required');
    }
    const invitation = this.findInvitation_(idOrCode);
    if (!invitation) {
      throw new Error('Invitation not found');
    }
    if (invitation.status !== 'pending') {
      throw new Error('Only pending invitations can be approved');
    }

    const code = this.issueInvitationCode_(invitation);
    const delivered = await this.deliverInvitationCode_(invitation, code);
    await this.persistInvitations_();

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:invitation-approved', {
        id: invitation.id,
        email: invitation.email,
        approvedBy: context.approvedBy || null,
        delivered
      });
    }
    return { ...this.publicInvitation_(invitation, code), delivered };
  }

  /**
   * Redeems an invitation to create a new user account.
   * The new account's identity is the invited email and its full name is
   * taken from the invitation. A code works once.
   * @param {string} code Invitation code.
   * @param {string} password Password for new account.
   * @return {Promise<Object>} Promise resolving to created user object.
   */
  async redeemInvitation(code, password) {
    if (!code || !password) {
      throw new Error('Invitation code and password are required');
    }

    const invitation = this.findInvitationByCode_(code);
    if (!invitation) {
      throw new Error('Invitation not found');
    }
    if (invitation.status === 'used') {
      throw new Error('This invitation has already been used');
    }
    if (invitation.status !== 'approved') {
      throw new Error('Invitation has not been approved');
    }
    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      throw new Error('Invitation has expired');
    }

    const strength = await this.validatePasswordStrength(password);
    if (!strength.valid) {
      throw new Error('Password does not meet strength requirements: ' + strength.errors.join(', '));
    }

    // Claim the code before the (slow, bcrypt) user creation so two concurrent
    // redemptions cannot both succeed.
    invitation.status = 'used';
    invitation.usedAt = new Date();
    const codeHash = invitation.codeHash;
    invitation.codeHash = null;

    let user;
    try {
      user = await this.createUser({
        email: invitation.email,
        fullName: invitation.name,
        password: password,
        role: 'user'
      });
    } catch (error) {
      invitation.status = 'approved';
      invitation.usedAt = null;
      invitation.codeHash = codeHash;
      throw error;
    }

    await this.persistInvitations_();
    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:invitation-redeemed', { id: invitation.id, email: invitation.email });
    }
    return user;
  }

  /**
   * Batch creates approved invitations (admin operation).
   * Skips rows missing a name or email; collects per-row errors without aborting the batch.
   * @param {Array<{name: string, email: string}>} invites Array of invitee objects.
   * @param {Object=} context Optional `{ createdBy }` for the audit event.
   * @return {Promise<{created: Array<Object>, errors: Array<{email: string, error: string}>}>}
   */
  async batchCreateInvitations(invites, context = {}) {
    const created = [];
    const errors = [];

    for (const item of invites) {
      try {
        created.push(await this.createInvitation({ name: item && item.name, email: item && item.email }, context));
      } catch (err) {
        errors.push({ email: (item && item.email) || '(missing)', error: err.message });
      }
    }

    return { created, errors };
  }

  /**
   * Issues a fresh code for an invitation (admin operation). The old code is
   * invalidated and a new expiry is set; a pending invitation becomes approved.
   * @param {string} idOrCode Invitation id (or existing code).
   * @return {Promise<Object>} The invitation, including its new plaintext `code`.
   */
  async recreateInvitation(idOrCode) {
    if (!idOrCode) {
      throw new Error('Invitation id is required');
    }
    const invitation = this.findInvitation_(idOrCode);
    if (!invitation) {
      throw new Error('Invitation not found');
    }
    if (invitation.status === 'used') {
      throw new Error('Cannot recreate an invitation that has already been redeemed');
    }

    const code = this.issueInvitationCode_(invitation);
    await this.persistInvitations_();
    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:invitation-recreated', { id: invitation.id, email: invitation.email });
    }
    return this.publicInvitation_(invitation, code);
  }

  /**
   * Lists all invitations (without codes or code hashes).
   * @return {Promise<Array<Object>>} Promise resolving to array of invitations.
   */
  async listInvitations() {
    return Array.from(this.invitationStore_().values()).map((inv) => this.publicInvitation_(inv));
  }

  /**
   * Looks up an invitation by its plaintext code (used by the redeem page).
   * @param {string} code Invitation code.
   * @return {Promise<Object>} Promise resolving to the invitation (no code hash).
   */
  async getInvitation(code) {
    if (!code) {
      throw new Error('Invitation code is required');
    }
    const invitation = this.findInvitationByCode_(code);
    if (!invitation) {
      throw new Error('Invitation not found');
    }
    return this.publicInvitation_(invitation);
  }

  /**
   * Creates a short-lived SSO session for email-based authentication.
   * @param {string} email User email address.
   * @param {number} ttlMinutes Time to live in minutes (default 5).
   * @return {Promise<Object>} Promise resolving to { token, expiresAt }.
   */
  async createSSOSession(email, ttlMinutes = 5) {
    if (!email) {
      throw new Error('Email is required');
    }

    const user = Array.from(this.users_.values()).find(u => u.email === email);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.isActive) {
      throw new Error('User account is inactive');
    }

    if (!this.ssoSessions_) {
      this.ssoSessions_ = new Map();
    }

    const sessionToken = this.generateSessionToken_();
    const expiresAt = new Date(Date.now() + (ttlMinutes * 60 * 1000));

    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
    const session = {
      token: sessionToken,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: userRoles,
      createdAt: new Date(),
      expiresAt: expiresAt,
      isSSO: true
    };

    this.ssoSessions_.set(sessionToken, session);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:sso-session-created', { email });
    }

    return {
      token: sessionToken,
      expiresAt: expiresAt
    };
  }

  /**
   * Validates an SSO token (short-lived session).
   * @param {string} token SSO session token.
   * @return {Promise<Object>} Promise resolving to session object if valid.
   */
  async validateSSOToken(token) {
    if (!token) {
      throw new Error('Token is required');
    }

    if (!this.ssoSessions_) {
      throw new Error('Invalid SSO token');
    }

    const session = this.ssoSessions_.get(token);
    if (!session) {
      throw new Error('Invalid SSO token');
    }

    if (session.expiresAt < new Date()) {
      this.ssoSessions_.delete(token);
      throw new Error('SSO token expired');
    }

    return session;
  }

  /**
   * Gets service status.
   * @return {Promise<Object>} Promise resolving to status object.
   */
  async getStatus() {
    return {
      service: 'auth',
      provider: this.constructor.name,
      users: this.users_.size,
      activeSessions: this.sessions_.size,
      roles: this.roles_.size,
      uptime: process.uptime()
    };
  }

  /**
   * Generates a unique ID.
   * @return {string} Unique identifier.
   * @private
   */
  generateId_() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generates a cryptographically secure session token.
   * @return {string} Session token (256 bits of entropy, hex-encoded).
   * @private
   */
  generateSessionToken_() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hashes a password using bcrypt with a per-user salt.
   * @param {string} password Plain text password.
   * @return {Promise<string>} Promise resolving to the bcrypt hash.
   * @private
   */
  async hashPassword_(password) {
    return bcrypt.hash(password, BCRYPT_COST);
  }

  /**
   * Verifies a password against a stored hash.
   * Supports transparent verification of legacy SHA-256 hashes so that
   * accounts created before the bcrypt migration can still authenticate;
   * callers should re-hash (see {@link AuthBase#needsRehash_}) on success.
   * @param {string} password Plain text password.
   * @param {string} hash Stored password hash.
   * @return {Promise<boolean>} Promise resolving to true if password is valid.
   * @private
   */
  async verifyPassword_(password, hash) {
    if (typeof hash !== 'string' || hash.length === 0) {
      return false;
    }

    // Modern bcrypt hashes are prefixed with $2a$/$2b$/$2y$.
    if (hash.startsWith('$2')) {
      return bcrypt.compare(password, hash);
    }

    // Legacy SHA-256 ("password" + static salt) hash — constant-time compare.
    const legacy = crypto.createHash('sha256').update(password + 'salt').digest('hex');
    const a = Buffer.from(legacy, 'utf8');
    const b = Buffer.from(hash, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Determines whether a stored hash should be upgraded to bcrypt.
   * @param {string} hash Stored password hash.
   * @return {boolean} True if the hash is in a legacy (non-bcrypt) format.
   * @private
   */
  needsRehash_(hash) {
    return typeof hash !== 'string' || !hash.startsWith('$2');
  }

  /**
   * Validates password strength.
   * @param {string} password Password to validate.
   * @return {Promise<Object>} Promise resolving to { valid: boolean, errors: Array<string> }.
   */
  async validatePasswordStrength(password) {
    const errors = [];

    if (!password || typeof password !== 'string') {
      errors.push('Password must be a non-empty string');
      return { valid: false, errors };
    }

    if (password.length < 10) {
      errors.push('Password must be at least 10 characters');
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one digit');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Generates a strong random password.
   * @return {string} A 16-character cryptographically secure random password.
   */
  generateStrongPassword() {
    const crypto = require('crypto');
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const special = '!@#$%^&*()_+-=[]{};\'":\\|,.<>/?';

    const allChars = uppercase + lowercase + digits + special;
    let password = '';

    // Ensure at least one of each required type
    // crypto.randomInt is a CSPRNG with no modulo bias (P0-3).
    const pick = (chars) => chars[crypto.randomInt(chars.length)];

    // Ensure at least one of each required type
    password += pick(uppercase);
    password += pick(lowercase);
    password += pick(digits);
    password += pick(special);

    // Fill remaining 12 characters randomly
    for (let i = 0; i < 12; i++) {
      password += pick(allChars);
    }

    // Shuffle the password (Fisher-Yates with a CSPRNG)
    const passwordArray = password.split('');
    for (let i = passwordArray.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
    }

    return passwordArray.join('');
  }

  /**
   * Adds user to role internal method.
   * @param {string} email User email address.
   * @param {string} role Role name.
   * @private
   */
  addUserToRole_(email, role) {
    if (!this.roles_.has(role)) {
      this.roles_.set(role, []);
    }
    const users = this.roles_.get(role);
    if (!users.includes(email)) {
      users.push(email);
    }
  }

  /**
   * Removes user from role internal method.
   * @param {string} email User email address.
   * @param {string} role Role name.
   * @private
   */
  removeUserFromRole_(email, role) {
    const users = this.roles_.get(role);
    if (users) {
      const index = users.indexOf(email);
      if (index > -1) {
        users.splice(index, 1);
      }
    }
  }

  /**
   * Returns user object without sensitive information.
   * @param {Object} user User object.
   * @return {Object} Safe user object.
   * @private
   */
  getSafeUser_(user) {
    const { password, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Creates authentication middleware for protecting routes.
   * Automatically handles login redirects with optional referrer tracking.
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.loginPath='/services/authservice/views/login.html'] - Path to login page
   * @param {boolean} [options.saveReferer=true] - Whether to save original URL as referrer
   * @returns {Function} Express middleware function
   * @example
   * const requireAuth = authservice.createAuthMiddleware();
   * app.use('/app', requireAuth, express.static(__dirname + '/public/app'));
   */
  createAuthMiddleware(options = {}) {
    const { createAuthMiddleware } = require('../middleware/authenticate');
    return createAuthMiddleware(options);
  }

  /**
   * Creates authentication middleware with custom response handling.
   * Allows custom logic for unauthorized requests (e.g., JSON responses for APIs).
   * @param {Object} [options={}] - Configuration options
   * @param {Function} [options.onUnauthorized] - Custom handler for unauthenticated requests
   * @returns {Function} Express middleware function
   * @example
   * const requireAuthApi = authservice.createAuthMiddlewareWithHandler({
   *   onUnauthorized: (req, res) => res.status(401).json({ error: 'Unauthorized' })
   * });
   * app.get('/api/protected', requireAuthApi, handler);
   */
  createAuthMiddlewareWithHandler(options = {}) {
    const { createAuthMiddlewareWithHandler } = require('../middleware/authenticate');
    return createAuthMiddlewareWithHandler(options);
  }

  /**
   * Returns a passport strategy factory when supported by the provider.
   * Providers that do not integrate with passport should override this method.
   * @return {?Function} Strategy factory or null if unsupported.
   */
  getAuthStrategy() {
    let LocalStrategy;
    try {
      ({ Strategy: LocalStrategy } = require('passport-local'));
    } catch (error) {
      return null;
    }

    const strategy = new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password'
      },
      async (email, password, done) => {
        try {
          const result = await this.authenticateUser(email, password);
          return done(null, result.user, { session: result.session });
        } catch (error) {
          // Return a generic failure message: the raw error can reveal
          // internal details or enable user enumeration (e.g. "user not
          // found" vs "wrong password"). The specific error stays server-side.
          return done(null, false, { message: 'Invalid credentials' });
        }
      }
    );

    return {
      strategy,
      serializeUser: (user, done) => {
        try {
          if (!user || !user.email) {
            return done(new Error('User object must have an email property'));
          }
          done(null, user.email);
        } catch (error) {
          done(error);
        }
      },
      deserializeUser: async (email, done) => {
        try {
          if (!email) {
            return done(new Error('Email is required for deserialization'));
          }
          const user = await this.getUser(email);
          done(null, user);
        } catch (error) {
          done(error, null);
        }
      }
    };
  }
}

module.exports = AuthBase;
