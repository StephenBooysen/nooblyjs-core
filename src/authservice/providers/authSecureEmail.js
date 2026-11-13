/**
 * @fileoverview Secure Email Authentication Provider
 * Authentication provider for Teams/Edge extensions using email + secure key.
 * Extends AuthPassport to authenticate users with email and a pre-shared secure key.
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('crypto');
const AuthPassport = require('./authPassport');

/**
 * Secure Email authentication provider.
 * Authenticates users with email + secure key from a JSON data file.
 * Extends AuthPassport to leverage passport session management and bearer tokens.
 * @class
 * @extends {AuthPassport}
 */
class AuthSecureEmail extends AuthPassport {
  /**
   * Initializes the secure email authentication provider.
   * Loads allowed users from JSON file and initializes passport with custom strategy.
   *
   * @param {Object=} options Configuration options.
   * @param {string=} options.dataDir Directory to store secure emails JSON file (default: './.application/data')
   * @param {EventEmitter=} eventEmitter Optional event emitter for auth events.
   */
  constructor(options = {}, eventEmitter) {
    super(options, eventEmitter);

    this.dataDir = options.dataDir || './.application/data';
    this.secureEmailsFile = path.join(this.dataDir, 'secure-emails.json');

    // In-memory map of allowed secure email users
    // Key: email (lowercase), Value: { email, secureKey, fullName, role, isActive, ... }
    this.secureUsers_ = new Map();

    this.settings = {
      description: 'Secure email authentication provider for Teams/Edge extensions',
      list: [
        { setting: 'dataDir', type: 'string', values: [this.dataDir] }
      ]
    };

    // Initialize secure emails from file. The promise is exposed as `this.ready`
    // so callers (and tests) can deterministically await the initial load
    // instead of relying on arbitrary timeouts.
    this.ready = this.initializeSecureEmailsFile_().catch(error => {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:secure-email-init-error', {
          error: error.message
        });
      }
    });

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:provider-initialized', {
        provider: 'secure-email',
        message: 'Secure email auth provider initialized',
        secureUsersCount: this.secureUsers_.size
      });
    }
  }

  /**
   * Secure-email accounts live in their own map, so session checks use it.
   * @override
   * @param {string} email Account email
   * @return {Object|undefined} Stored secure-email user
   */
  lookupSessionUser_(email) {
    return this.secureUsers_.get(String(email || '').toLowerCase());
  }

  /**
   * Loads secure email users from JSON data file.
   * Creates empty file if it doesn't exist.
   *
   * @private
   */
  async initializeSecureEmailsFile_() {
    try {
      const data = await fs.readFile(this.secureEmailsFile, 'utf8');
      const parsed = JSON.parse(data);

      if (parsed.users && Array.isArray(parsed.users)) {
        for (const user of parsed.users) {
          if (user.email && user.secureKey) {
            this.secureUsers_.set(user.email.toLowerCase(), user);
          }
        }
      }

      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:secure-email-loaded', {
          userCount: this.secureUsers_.size
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist yet - will be created on first save
      this.logger_?.info?.(`[${this.constructor.name}] Secure emails file not found, will create on first save`);
    }
  }

  /**
   * Authenticates a user with email and secure key.
   * Validates credentials against stored secure users and returns session token.
   *
   * @param {string} email User email address
   * @param {string} secureKey The secure key for this email
   * @return {Promise<Object>} Promise resolving to { user, session } object
   * @throws {Error} When email or key is invalid, or user is not active
   *
   * @example
   * const result = await authSecureEmail.authenticateWithSecureEmail('user@example.com', 'their_key_123');
   * // Returns: { user: { id, email, fullName, roles }, session: { token, expiresAt } }
   */
  async authenticateWithSecureEmail(email, secureKey) {
    // Validate inputs
    if (!email || typeof email !== 'string' || email.trim() === '') {
      const error = new Error('Email is required');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'authenticateWithSecureEmail',
          error: error.message
        });
      }
      throw error;
    }

    if (!secureKey || typeof secureKey !== 'string' || secureKey.trim() === '') {
      const error = new Error('Secure key is required');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'authenticateWithSecureEmail',
          error: error.message
        });
      }
      throw error;
    }

    const emailLower = email.toLowerCase();
    const user = this.secureUsers_.get(emailLower);

    if (!user) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:secure-email-auth-failed', {
          email: emailLower,
          reason: 'user_not_found'
        });
      }
      throw new Error('Invalid email or secure key');
    }

    // Verify secure key hash using constant-time comparison
    try {
      const isValid = await this.verifySecureKeyHash_(secureKey, user.secureKey);
      if (!isValid) {
        if (this.eventEmitter_) {
          this.eventEmitter_.emit('auth:secure-email-auth-failed', {
            email: emailLower,
            reason: 'invalid_key'
          });
        }
        throw new Error('Invalid email or secure key');
      }
    } catch (error) {
      if (error.message === 'Invalid email or secure key') {
        throw error;
      }
      // Hash verification error - treat as invalid credentials for security
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:secure-email-auth-failed', {
          email: emailLower,
          reason: 'verification_error'
        });
      }
      throw new Error('Invalid email or secure key');
    }

    // Check if user is active
    if (user.isActive === false) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:secure-email-auth-failed', {
          email: emailLower,
          reason: 'account_disabled'
        });
      }
      throw new Error('User account is not active');
    }

    // Update last login timestamp
    user.lastLogin = new Date();
    await this.saveSecureEmailsFile_();

    // Create session token
    const sessionToken = this.generateSessionToken_();
    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
    const fullName = user.fullName || user.email;
    const session = {
      token: sessionToken,
      userId: user.id || this.generateId_(),
      email: user.email,
      fullName,
      roles: userRoles,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)), // 24 hours (absolute)
      epoch: user.sessionEpoch || 0,
      lastSeenAt: Date.now()
    };

    this.sessions_.set(sessionToken, session);

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:secure-email-auth', {
        email: emailLower
      });
    }

    return {
      user: {
        id: session.userId,
        email: user.email,
        fullName,
        roles: userRoles
      },
      session: { token: sessionToken, expiresAt: session.expiresAt }
    };
  }

  /**
   * Adds a new secure email user to the system.
   * Hashes the secure key before storage.
   *
   * @param {string} email User email address
   * @param {string} secureKey The secure key for authentication
   * @param {string} fullName Full display name (optional, defaults to email)
   * @param {string} role User role (optional, defaults to 'user')
   * @return {Promise<Object>} Promise resolving to user object (without key hash)
   * @throws {Error} When user already exists or parameters are invalid
   *
   * @example
   * const user = await authSecureEmail.addSecureEmailUser(
   *   'newuser@example.com',
   *   'their_secure_key_123',
   *   'New User',
   *   'user'
   * );
   */
  async addSecureEmailUser(email, secureKey, fullName, role = 'user') {
    // Validate inputs
    if (!email || typeof email !== 'string' || email.trim() === '') {
      const error = new Error('Email is required');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'addSecureEmailUser',
          error: error.message
        });
      }
      throw error;
    }

    if (!secureKey || typeof secureKey !== 'string' || secureKey.trim() === '') {
      const error = new Error('Secure key is required');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'addSecureEmailUser',
          error: error.message
        });
      }
      throw error;
    }

    const emailLower = email.toLowerCase();

    if (this.secureUsers_.has(emailLower)) {
      throw new Error('User already exists');
    }

    // Hash the secure key
    const secureKeyHash = await this.hashSecureKey_(secureKey);

    // Create user object
    const userRoles = Array.isArray(role) ? role : [role || 'user'];
    const user = {
      id: this.generateId_(),
      email: emailLower,
      secureKey: secureKeyHash,
      fullName: fullName || email,
      roles: userRoles,
      isActive: true,
      createdAt: new Date(),
      lastLogin: null
    };

    this.secureUsers_.set(emailLower, user);
    await this.saveSecureEmailsFile_();

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:secure-email-user-added', {
        email: emailLower,
        fullName: user.fullName,
        roles: userRoles
      });
    }

    // Return user without sensitive data
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: userRoles,
      isActive: user.isActive,
      createdAt: user.createdAt
    };
  }

  /**
   * Removes a secure email user from the system.
   *
   * @param {string} email Email address of user to remove
   * @return {Promise<void>}
   * @throws {Error} When user not found
   *
   * @example
   * await authSecureEmail.removeSecureEmailUser('olduser@example.com');
   */
  async removeSecureEmailUser(email) {
    if (!email || typeof email !== 'string' || email.trim() === '') {
      const error = new Error('Email is required');
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:validation-error', {
          method: 'removeSecureEmailUser',
          error: error.message
        });
      }
      throw error;
    }

    const emailLower = email.toLowerCase();

    if (!this.secureUsers_.has(emailLower)) {
      throw new Error('User not found');
    }

    this.secureUsers_.delete(emailLower);
    await this.saveSecureEmailsFile_();

    if (this.eventEmitter_) {
      this.eventEmitter_.emit('auth:secure-email-user-removed', {
        email: emailLower
      });
    }
  }

  /**
   * Lists all secure email users (without sensitive data).
   *
   * @return {Promise<Array<Object>>} Promise resolving to array of user objects
   *
   * @example
   * const users = await authSecureEmail.listSecureEmailUsers();
   */
  async listSecureEmailUsers() {
    return Array.from(this.secureUsers_.values()).map(user => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: Array.isArray(user.roles) ? user.roles : [user.role || 'user'],
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    }));
  }

  /**
   * Saves secure email users to JSON file.
   * Creates directory if it doesn't exist.
   *
   * @private
   */
  async saveSecureEmailsFile_() {
    try {
      // Ensure directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      const data = {
        users: Array.from(this.secureUsers_.values())
      };

      await fs.writeFile(
        this.secureEmailsFile,
        JSON.stringify(data, null, 2),
        'utf8'
      );
    } catch (error) {
      if (this.eventEmitter_) {
        this.eventEmitter_.emit('auth:secure-email-file-error', {
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Hashes a secure key for storage using SHA-256 with salt.
   * Format: salt:hash
   *
   * @param {string} key Plain text secure key
   * @return {Promise<string>} Promise resolving to hashed key with salt prefix
   * @private
   */
  async hashSecureKey_(key) {
    // Generate random salt
    const salt = crypto.randomBytes(16).toString('hex');
    // Hash key with salt
    const hash = crypto.createHash('sha256').update(key + salt).digest('hex');
    // Return salted hash format: salt:hash
    return `${salt}:${hash}`;
  }

  /**
   * Verifies a secure key against stored hash using constant-time comparison.
   * Prevents timing attacks by comparing hashes with equal time regardless of match.
   *
   * @param {string} key Plain text secure key to verify
   * @param {string} storedHash Stored hash in format salt:hash
   * @return {Promise<boolean>} Promise resolving to true if key matches
   * @private
   */
  async verifySecureKeyHash_(key, storedHash) {
    // Parse stored hash format: salt:hash
    const [salt, hash] = storedHash.split(':');

    if (!salt || !hash) {
      return false;
    }

    // Recompute hash using stored salt
    const computedHash = crypto.createHash('sha256').update(key + salt).digest('hex');

    // Use constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(computedHash)
      ).valueOf();
    } catch (error) {
      // timingSafeEqual throws if buffers are different lengths
      return false;
    }
  }

  /**
   * Generates a unique ID.
   * Used for user IDs.
   *
   * @return {string} Unique identifier
   * @private
   */
  generateId_() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Generates a session token.
   * Inherited from AuthBase via super.
   * Override to ensure we have it available.
   *
   * @return {string} Session token
   * @private
   */
  generateSessionToken_() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Gets service status with secure email info.
   * @return {Promise<Object>} Promise resolving to status object.
   */
  async getStatus() {
    const baseStatus = await super.getStatus();
    return {
      ...baseStatus,
      provider: 'secure-email',
      secureEmailUsers: this.secureUsers_.size,
      dataFile: this.secureEmailsFile
    };
  }
}

module.exports = AuthSecureEmail;
