/**
 * @fileoverview File-based Authentication Provider
 * File-based authentication provider with persistent storage and secure password handling.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('crypto');
const AuthBase = require('./authBase');

/**
 * File-based authentication provider.
 * Stores all user data and sessions in JSON files with secure password generation.
 * @class
 * @extends {AuthBase}
 */
class AuthFile extends AuthBase {
  /**
   * Initializes the file authentication provider.
   * @param {Object=} options Configuration options.
   * @param {string=} options.dataDir Directory to store user data files (default: './data/auth')
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    /**
     * Optional logging service injected via dependencies; logging calls use
     * optional chaining so the provider works when no logger is available.
     * @protected {?Object}
     */
    this.logger = options.dependencies?.logging || null;

    this.settings = {};
    this.settings.desciption = "This provider exposes the NooblyJS file implementation settings"
    this.settings.list = [
      {setting: "datadir", type: "string", values : ['/.data/']}
    ]

    this.settings.datadir = options.dataDir;

    this.usersFile_ = path.join(this.settings.datadir, 'users.json');
    this.rolesFile_ = path.join(this.settings.datadir, 'roles.json');
    this.sessionsFile_ = path.join(this.settings.datadir, 'sessions.json');
    this.invitationsFile_ = path.join(this.settings.datadir, 'invitations.json');

    // Initialize file storage
    this.initializeFileStorage_().catch(error => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:file-storage-error', {
          error: error.message
        });
      }
    });

    // Initialize passport for session management even though file provider doesn't use passport strategies
    // This is needed for req.logIn() to work in routes
    this.initializePassport_();

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:provider-initialized', {
        provider: 'file',
        message: 'File auth provider initialized'
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
   * Generates a cryptographically secure random password.
   * @param {number} length Password length (default: 16)
   * @return {string} Generated password
   * @private
   */
  generateSecurePassword_(length = 16) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';

    // Ensure at least one character from each category
    const categories = [
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz',
      '0123456789',
      '!@#$%^&*()_+-=[]{}|;:,.<>?'
    ];

    // Add one character from each category
    for (const category of categories) {
      const randomIndex = crypto.randomInt(category.length);
      password += category[randomIndex];
    }

    // Fill remaining length with random characters
    for (let i = password.length; i < length; i++) {
      const randomIndex = crypto.randomInt(charset.length);
      password += charset[randomIndex];
    }

    // Shuffle the password to avoid predictable patterns
    return password.split('').sort(() => crypto.randomInt(3) - 1).join('');
  }

  /**
   * Initializes file storage and creates default admin user if needed.
   * @private
   */
  async initializeFileStorage_() {
    try {
      // Ensure data directory exists
      await fs.mkdir(this.settings.datadir, { recursive: true });

      // Load existing data or create new files
      await this.loadUsersFromFile_();
      await this.loadRolesFromFile_();
      await this.loadSessionsFromFile_();
      await this.loadInvitationsFromFile_();

      // Create default admin user if no users exist
      if (this.users_.size === 0) {
        await this.createDefaultAdmin_();
      }

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:file-storage-initialized', {
          message: 'File storage initialized successfully',
          usersCount: this.users_.size,
          dataDir: this.settings.datadir
        });
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:file-storage-initialization-error', {
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Creates a default admin user with a secure generated password.
   * @private
   */
  async createDefaultAdmin_() {
    // P2-3: Never log or emit the admin password. Prefer an operator-supplied
    // password (DEFAULT_ADMIN_PASSWORD); otherwise generate one and write it to
    // a 0600 bootstrap file, logging only the path so it never enters logs or
    // the event bus.
    const fromEnv = process.env.DEFAULT_ADMIN_PASSWORD;
    const adminPassword = fromEnv || this.generateSecurePassword_(20);
    // The default admin is identified by its email address.
    const adminEmail = 'admin@localhost';

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:default-admin-creating', {
        email: adminEmail
      });
    }

    try {
      await this.createUser({
        email: adminEmail,
        fullName: 'Administrator',
        password: adminPassword,
        role: 'admin'
      });

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:default-admin-created', {
          message: 'Default admin user created with secure password',
          email: adminEmail
        });
      }

      if (fromEnv) {
        this.logger?.warn(
          `[${this.constructor.name}] Default admin user created using DEFAULT_ADMIN_PASSWORD`,
          { email: adminEmail }
        );
      } else {
        // Write the generated password to a restricted bootstrap file so an
        // operator can retrieve it once, then delete the file. The secret is
        // never written to the application logs or the event bus.
        const secretFile = path.join(this.settings.datadir, 'INITIAL_ADMIN_PASSWORD.txt');
        try {
          await fs.writeFile(
            secretFile,
            `email: ${adminEmail}\npassword: ${adminPassword}\n`,
            { encoding: 'utf8', mode: 0o600 }
          );
          this.logger?.warn(
            `[${this.constructor.name}] Default admin user created — initial password written to a restricted file. Retrieve it, log in, then delete the file.`,
            { email: adminEmail, credentialsFile: secretFile }
          );
        } catch (writeErr) {
          this.logger?.error(
            `[${this.constructor.name}] Default admin created but the initial-password file could not be written. Set DEFAULT_ADMIN_PASSWORD and recreate.`,
            { email: adminEmail, error: writeErr?.message }
          );
        }
      }
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:default-admin-creation-error', {
          error: error.message
        });
      }

      this.logger?.error(
        `[${this.constructor.name}] Failed to create default admin user`,
        { error: error.message }
      );
      throw error;
    }
  }

  /**
   * Loads users from file.
   * @private
   */
  async loadUsersFromFile_() {
    try {
      const data = await fs.readFile(this.usersFile_, 'utf8');
      const users = JSON.parse(data);

      // Migrate legacy records to the current schema while loading. Two
      // migrations run here:
      //   1. role (string) -> roles (array)
      //   2. map key (legacy username) -> email, the current account identity.
      //
      // Pre-refactor data keyed users by their username; all current code keys
      // and looks the in-memory map up by email. An un-migrated record therefore
      // still appears in listUsers() (which reports user.email) but every
      // users_.get(email) misses, surfacing to operators as "User not found"
      // when resetting a password, changing roles, or deleting the account.
      let needsSave = false;
      const migrated = new Map();

      for (const [key, user] of Object.entries(users)) {
        if (user.role && !user.roles) {
          // Convert single role to roles array
          user.roles = [user.role];
          delete user.role;
          needsSave = true;
        } else if (!user.roles) {
          // Ensure roles array exists
          user.roles = ['user'];
          needsSave = true;
        }

        // Ensure the record carries an email (the identity). Legacy records
        // without one fall back to their original key so the account stays usable.
        if (!user.email) {
          user.email = key;
          needsSave = true;
        }

        // Backfill a display name so migrated records match createUser() output
        // (the dashboard otherwise renders the full name as "—").
        if (!user.fullName) {
          user.fullName = user.username || user.email;
          needsSave = true;
        }

        // Drop the obsolete username field; email is now the sole identity.
        if (user.username !== undefined) {
          delete user.username;
          needsSave = true;
        }

        // Re-key by email so lookups (reset/role/delete) resolve correctly.
        if (key !== user.email) {
          needsSave = true;
        }

        migrated.set(user.email, user);
      }

      this.users_ = migrated;

      // Save migrated format
      if (needsSave) {
        await this.saveUsersToFile_();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, start with empty users
      this.users_ = new Map();
    }
  }

  /**
   * Saves users to file.
   * @private
   */
  async saveUsersToFile_() {
    const users = Object.fromEntries(this.users_);
    await fs.writeFile(this.usersFile_, JSON.stringify(users, null, 2), 'utf8');
  }

  /**
   * Loads invitations from file so pending and approved codes survive a restart.
   * Dates are revived from their JSON strings, because expiry checks compare them.
   * @private
   * @return {Promise<void>}
   */
  async loadInvitationsFromFile_() {
    let raw;
    try {
      raw = await fs.readFile(this.invitationsFile_, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const records = JSON.parse(raw || '[]');
    this.invitations_.clear();
    for (const record of records) {
      for (const field of ['createdAt', 'approvedAt', 'usedAt', 'expiresAt']) {
        if (record[field]) record[field] = new Date(record[field]);
      }
      record.redeeming = false;
      this.invitations_.set(record.id, record);
    }
  }

  /**
   * Writes invitations to file atomically (temporary file, then rename).
   * Hashed codes only; plain codes are never stored.
   * @protected
   * @param {Array<Object>} records Invitation records
   * @return {Promise<void>}
   */
  async saveInvitations_(records) {
    await fs.mkdir(this.settings.datadir, { recursive: true });
    const tmp = `${this.invitationsFile_}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, this.invitationsFile_);
  }

  /**
   * Loads roles from file.
   * @private
   */
  async loadRolesFromFile_() {
    try {
      const data = await fs.readFile(this.rolesFile_, 'utf8');
      const roles = JSON.parse(data);
      this.roles_ = new Map(Object.entries(roles));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, initialize with default roles
      this.roles_ = new Map();
      this.roles_.set('admin', []);
      this.roles_.set('user', []);
      this.roles_.set('guest', []);
      await this.saveRolesToFile_();
    }
  }

  /**
   * Saves roles to file.
   * @private
   */
  async saveRolesToFile_() {
    const roles = Object.fromEntries(this.roles_);
    await fs.writeFile(this.rolesFile_, JSON.stringify(roles, null, 2), 'utf8');
  }

  /**
   * Loads sessions from file.
   * @private
   */
  async loadSessionsFromFile_() {
    try {
      const data = await fs.readFile(this.sessionsFile_, 'utf8');
      const sessions = JSON.parse(data);

      // Clean up expired sessions while loading and convert date strings to Date objects
      const now = new Date();
      const validSessions = {};

      for (const [token, session] of Object.entries(sessions)) {
        // Convert date strings to Date objects
        session.createdAt = new Date(session.createdAt);
        session.expiresAt = new Date(session.expiresAt);

        if (session.expiresAt > now) {
          validSessions[token] = session;
        }
      }

      this.sessions_ = new Map(Object.entries(validSessions));

      // Save cleaned sessions back to file
      if (Object.keys(validSessions).length !== Object.keys(sessions).length) {
        await this.saveSessionsToFile_();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, start with empty sessions
      this.sessions_ = new Map();
    }
  }

  /**
   * Saves sessions to file.
   * @private
   */
  async saveSessionsToFile_() {
    const sessions = Object.fromEntries(this.sessions_);
    await fs.writeFile(this.sessionsFile_, JSON.stringify(sessions, null, 2), 'utf8');
  }

  /**
   * Creates a new user account and persists to file.
   * @param {Object} userData User data object.
   * @return {Promise<Object>} Promise resolving to user object.
   * @override
   */
  async createUser(userData) {
    const user = await super.createUser(userData);
    await this.saveUsersToFile_();
    return user;
  }

  /**
   * Updates user information and persists to file.
   * @param {string} email Email of the user to update.
   * @param {Object} updateData Data to update.
   * @return {Promise<Object>} Promise resolving to updated user object.
   * @override
   */
  async updateUser(email, updateData) {
    const user = await super.updateUser(email, updateData);
    await this.saveUsersToFile_();
    return user;
  }

  /**
   * Deletes a user account and persists changes to file.
   * @param {string} email Email of the user to delete.
   * @return {Promise<void>} Promise resolving when user is deleted.
   * @override
   */
  async deleteUser(email) {
    await super.deleteUser(email);
    await this.saveUsersToFile_();
  }

  /**
   * Authenticates a user and creates a session, persisting to file.
   * @param {string} email User email address.
   * @param {string} password Password.
   * @return {Promise<Object>} Promise resolving to auth result.
   * @override
   */
  async authenticateUser(email, password) {
    const result = await super.authenticateUser(email, password);
    await this.saveSessionsToFile_();
    return result;
  }

  /**
   * Validates a session token and persists any session cleanup to file.
   * @param {string} token Session token.
   * @return {Promise<Object>} Promise resolving to session object if valid.
   * @override
   */
  async validateSession(token) {
    const session = this.sessions_.get(token);

    if (!session) {
      throw new Error('Invalid session');
    }

    if (session.expiresAt < new Date()) {
      this.sessions_.delete(token);
      // Persist the session deletion to file
      await this.saveSessionsToFile_();
      throw new Error('Session expired');
    }

    return session;
  }

  /**
   * Logs out a user and persists session changes to file.
   * @param {string} token Session token.
   * @return {Promise<void>} Promise resolving when logged out.
   * @override
   */
  async logout(token) {
    await super.logout(token);
    await this.saveSessionsToFile_();
  }

  /**
   * Gets service status with file-specific information.
   * @return {Promise<Object>} Promise resolving to status object.
   * @override
   */
  async getStatus() {
    const baseStatus = await super.getStatus();

    // Check file system status
    let filesStatus = 'unknown';
    try {
      await fs.access(this.settings.datadir);
      filesStatus = 'accessible';
    } catch (error) {
      filesStatus = 'inaccessible';
    }

    return {
      ...baseStatus,
      provider: 'file',
      storage: 'file-based',
      persistent: true,
      dataDirectory: this.settings.datadir,
      filesStatus,
      files: {
        users: this.usersFile_,
        roles: this.rolesFile_,
        sessions: this.sessionsFile_
      }
    };
  }

  /**
   * Initializes passport for session management.
   * File provider doesn't use passport strategies, but needs passport for req.logIn() to work.
   * @private
   */
  initializePassport_() {
    try {
      this.passport_ = require('passport');
      const strategyConfig = super.getAuthStrategy();

      if (strategyConfig && typeof strategyConfig === 'object') {
        const { serializeUser, deserializeUser } = strategyConfig;

        // Only register serialization once to avoid conflicts with multiple instances
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
          message: 'Passport not available for session management',
          error: error.message
        });
      }
    }
  }
}

module.exports = AuthFile;