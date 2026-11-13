/**
 * @fileoverview Authentication API routes for Express.js application.
 * Provides RESTful endpoints for user authentication, user management,
 * role management, and session handling.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const { postLoginRedirect } = require('../modules/redirect');
const rateLimit = require('express-rate-limit');
const { sendSafeError } = require('../../shared/utils/safeError');
const { capLimit, validate } = require('../../shared/utils/validation');

/**
 * Configures and registers authentication routes with the Express application.
 * Sets up endpoints for auth operations including login, logout, user management,
 * and role-based access control.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} auth - The authentication provider instance
 * @param {Object=} analytics - Analytics module instance for tracking auth activity
 * @return {void}
 */
module.exports = (options, eventEmitter, auth, analytics) => {
  if (options['express-app'] && auth) {
    const app = options['express-app'];
    const authMiddleware = options.authMiddleware;
    const requireAuthenticatedSession = createSessionAwareAuthGuard(auth, authMiddleware);

    // Helper function to handle async route errors
    const asyncHandler = (fn) => (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };

    // P1-3: Brute-force protection on login.
    // (1) Per-IP rate limit on the login endpoint.
    const loginRateLimiter = rateLimit({
      windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS) || 15 * 60 * 1000,
      max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: 'Too many login attempts. Please try again later.'
      }
    });

    // (2) Per-account lockout (in-memory) so credential stuffing cannot rotate
    // source IPs to bypass the per-IP limit. After LOCK_THRESHOLD failures
    // within the window the account is temporarily locked.
    const LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD) || 5;
    const LOCK_WINDOW_MS = Number(process.env.LOGIN_LOCK_WINDOW_MS) || 15 * 60 * 1000;
    const LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_MS) || 15 * 60 * 1000;
    const failedLogins = new Map(); // email -> { count, firstAt, lockedUntil }

    const loginLockUntil = (email) => {
      const rec = failedLogins.get(email);
      if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
        return rec.lockedUntil;
      }
      return 0;
    };

    const recordLoginFailure = (email) => {
      const now = Date.now();
      const rec = failedLogins.get(email) || { count: 0, firstAt: now, lockedUntil: 0 };
      if (now - rec.firstAt > LOCK_WINDOW_MS) {
        rec.count = 0;
        rec.firstAt = now;
      }
      rec.count += 1;
      if (rec.count >= LOCK_THRESHOLD) {
        rec.lockedUntil = now + LOCK_DURATION_MS;
      }
      failedLogins.set(email, rec);
    };

    const clearLoginFailures = (email) => failedLogins.delete(email);

    // Invitation endpoints are public, so they are rate limited per IP. The
    // code is 128 bits, which makes guessing infeasible; the limit stops a
    // flood of requests and redemption attempts from one source.
    const invitationRateLimiter = rateLimit({
      windowMs: Number(process.env.INVITATION_RATE_WINDOW_MS) || 15 * 60 * 1000,
      max: Number(process.env.INVITATION_RATE_LIMIT_MAX) || 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: 'Too many invitation requests. Please try again later.'
      }
    });

    // Admin invitation operations need the admin role, not just any session.
    const requireAdminSession = [
      requireAuthenticatedSession,
      (req, res, next) => {
        const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
        if (roles.includes('admin')) return next();
        return res.status(403).json({
          success: false,
          error: 'Administrator role is required'
        });
      }
    ];

    /**
     * POST /services/authservice/api/register
     * Direct registration is disabled — accounts are created via admin invitation only.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/register',
      asyncHandler(async (req, res) => {
        res.status(403).json({
          success: false,
          error: 'Direct registration is disabled. Please use an invitation link sent by an administrator.'
        });
      })
    );

    /**
     * POST /services/authservice/api/login
     * Authenticates a user and creates a session.
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Login credentials
     * @param {string} req.body.email - Email address (account identity)
     * @param {string} req.body.password - Password
     * @param {string} req.body.returnUrl - Optional return URL after successful login
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/login',
      loginRateLimiter,
      // P2-7: bound credential sizes; returnUrl must be a same-site path
      // (blocks open redirects such as https://evil.example or //evil.example).
      validate({
        body: {
          email: { type: 'string', required: true, maxLength: 254 },
          password: { type: 'string', required: true, maxLength: 1024 },
          returnUrl: { type: 'string', maxLength: 2048, pattern: /^\/(?![\/\\])/ }
        }
      }),
      asyncHandler(async (req, res) => {
        const { email, password, returnUrl } = req.body;

        // Per-account lockout check (P1-3).
        const lockedUntil = email ? loginLockUntil(email) : 0;
        if (lockedUntil) {
          const retryAfter = Math.ceil((lockedUntil - Date.now()) / 1000);
          res.set('Retry-After', String(retryAfter));
          eventEmitter.emit('auth:login-locked', { email });
          return res.status(429).json({
            success: false,
            error: 'Account temporarily locked due to repeated failed login attempts. Try again later.'
          });
        }

        try {
          const result = await auth.authenticateUser(email, password);
          clearLoginFailures(email);
          eventEmitter.emit('auth:login-api', { email });

          // Establish Passport session so req.isAuthenticated() returns true
          // This is critical for middleware protection to work
          // MUST wait for logIn to complete before sending response
          if (result.user && req.logIn) {
            try {
              await new Promise((resolve, reject) => {
                req.logIn(result.user, (err) => {
                  if (err) {
                    eventEmitter.emit('auth:passport-error', { error: err.message });
                    return reject(err);
                  }
                  resolve();
                });
              });
            } catch (err) {
              eventEmitter.emit('auth:passport-error', { error: err.message });
              throw err;
            }
          }

          // Where to go next: the page they were heading to > the app's loginSuccessRedirectUrl > /services
          // Feature 23: the browser keeps only the session cookie. The provider session
          // token stays on the Express session so that logout can revoke it.
          if (req.session && result.session?.token) {
            req.session.authToken = result.session.token;
          }

          const redirectUrl = postLoginRedirect(returnUrl, options);

          res.status(200).json({
            success: true,
            message: 'Login successful',
            data: result,
            redirectUrl: redirectUrl
          });
        } catch (error) {
          // Record the failure for per-account lockout (P1-3).
          if (email) {
            recordLoginFailure(email);
          }
          // Return user-friendly error response
          res.status(401).json({
            success: false,
            error: 'Login failed'
          });
        }
      })
    );

    /**
     * GET /services/authservice/api/auth/check
     * Reports whether the browser's session cookie belongs to a signed-in user
     * (feature 23). Public, and it reveals nothing to an anonymous caller beyond
     * `authenticated: false`.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/authservice/api/auth/check', (req, res) => {
      const signedIn = typeof req.isAuthenticated === 'function' && req.isAuthenticated() && Boolean(req.user);
      if (!signedIn) {
        return res.json({ success: true, authenticated: false, user: null });
      }
      const u = req.user;
      res.json({
        success: true,
        authenticated: true,
        user: {
          email: u.email,
          fullName: u.fullName,
          roles: Array.isArray(u.roles) ? u.roles : [u.role || 'user']
        }
      });
    });

    /**
     * POST /services/authservice/api/logout
     * Logs out a user by invalidating every bearer token reference that may
     * be handling the session: the auth provider session record, the Passport
     * login, the Express session, and the session cookie.
     *
     * The bearer token is accepted from the Authorization header, x-auth-token
     * header, body, query, or session — whichever the client sent.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/logout',
      asyncHandler(async (req, res) => {
        const token = extractAuthToken(req) || req.session?.authToken || null;

        if (token) {
          try {
            await auth.logout(token);
          } catch (error) {
            eventEmitter.emit('auth:logout-error', { error: error.message });
          }
        }

        if (typeof req.logout === 'function') {
          await new Promise((resolve) => {
            try {
              const maybePromise = req.logout((err) => {
                if (err) {
                  eventEmitter.emit('auth:logout-error', { error: err.message });
                }
                resolve();
              });
              if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(resolve).catch((err) => {
                  eventEmitter.emit('auth:logout-error', { error: err.message });
                  resolve();
                });
              }
            } catch (error) {
              eventEmitter.emit('auth:logout-error', { error: error.message });
              resolve();
            }
          });
        }

        if (req.session) {
          if (typeof req.session.destroy === 'function') {
            await new Promise((resolve) => {
              req.session.destroy((err) => {
                if (err) {
                  eventEmitter.emit('auth:logout-error', { error: err.message });
                }
                resolve();
              });
            });
          } else {
            delete req.session.authToken;
            delete req.session.passport;
          }
        }

        const cookieName = (req.session && req.session.cookie && req.session.cookie.name) || 'connect.sid';
        res.clearCookie(cookieName, { path: '/' });
        res.clearCookie('authToken', { path: '/' });

        eventEmitter.emit('auth:logout-api', { hadToken: Boolean(token) });
        res.status(200).json({
          success: true,
          message: 'Logout successful'
        });
      })
    );

    /**
     * GET /services/authservice/logout
     * Browser-friendly logout. Performs the same teardown as the POST API
     * endpoint (auth provider session, Passport login, Express session, cookies)
     * then redirects to the login page so the user lands somewhere sensible.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/logout',
      asyncHandler(async (req, res) => {
        const token = extractAuthToken(req);

        if (token) {
          try {
            await auth.logout(token);
          } catch (error) {
            eventEmitter.emit('auth:logout-error', { error: error.message });
          }
        }

        if (typeof req.logout === 'function') {
          await new Promise((resolve) => {
            try {
              const maybePromise = req.logout((err) => {
                if (err) {
                  eventEmitter.emit('auth:logout-error', { error: err.message });
                }
                resolve();
              });
              if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(resolve).catch((err) => {
                  eventEmitter.emit('auth:logout-error', { error: err.message });
                  resolve();
                });
              }
            } catch (error) {
              eventEmitter.emit('auth:logout-error', { error: error.message });
              resolve();
            }
          });
        }

        if (req.session) {
          if (typeof req.session.destroy === 'function') {
            await new Promise((resolve) => {
              req.session.destroy((err) => {
                if (err) {
                  eventEmitter.emit('auth:logout-error', { error: err.message });
                }
                resolve();
              });
            });
          } else {
            delete req.session.authToken;
            delete req.session.passport;
          }
        }

        const cookieName = (req.session && req.session.cookie && req.session.cookie.name) || 'connect.sid';
        res.clearCookie(cookieName, { path: '/' });
        res.clearCookie('authToken', { path: '/' });

        eventEmitter.emit('auth:logout-redirect', { hadToken: Boolean(token) });

        const returnUrl = typeof req.query.returnUrl === 'string' ? req.query.returnUrl : null;
        const loginUrl = returnUrl
          ? `/services/authservice/views/login.html?returnUrl=${encodeURIComponent(returnUrl)}`
          : '/services/authservice/views/login.html';
        res.redirect(loginUrl);
      })
    );

    /**
     * POST /services/authservice/api/validate
     * Validates a session token.
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Validation data
     * @param {string} req.body.token - Session token to validate
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/validate',
      asyncHandler(async (req, res) => {
        const { token } = req.body;

        try {
          const session = await auth.validateSession(token);
          res.status(200).json({
            success: true,
            message: 'Session valid',
            data: session
          });
        } catch (error) {
          // Return success: false for invalid/expired sessions
          res.status(200).json({
            success: false,
            message: 'Session invalid'
          });
        }
      })
    );

    /**
     * POST /services/authservice/api/auth/password/validate
     * Validates password strength.
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Password data
     * @param {string} req.body.password - Password to validate
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/auth/password/validate',
      asyncHandler(async (req, res) => {
        const { password } = req.body;

        if (!password) {
          return res.status(400).json({
            success: false,
            error: 'Password is required'
          });
        }

        const result = await auth.validatePasswordStrength(password);
        res.status(200).json({
          success: result.valid,
          data: result
        });
      })
    );

    /**
     * GET /services/authservice/api/auth/password/generate
     * Generates a strong random password.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/auth/password/generate',
      asyncHandler(async (req, res) => {
        const password = auth.generateStrongPassword();
        res.status(200).json({
          success: true,
          data: { password }
        });
      })
    );

    /**
     * GET /services/authservice/api/users
     * Lists all users (admin only).
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/users',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const users = await auth.listUsers();
        res.status(200).json({
          success: true,
          data: users,
          total: users.length
        });
      })
    );

    /**
     * GET /services/authservice/api/users/:email
     * Gets a specific user by email.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.email - Email of the user to retrieve
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/users/:email',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const user = await auth.getUser(req.params.email);
        res.status(200).json({
          success: true,
          data: user
        });
      })
    );

    /**
     * PUT /services/authservice/api/users/:email
     * Updates a user's information.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.email - Email of the user to update
     * @param {Object} req.body - Update data
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.put(
      '/services/authservice/api/users/:email',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const user = await auth.updateUser(req.params.email, req.body);
        eventEmitter.emit('auth:user-updated-api', { email: req.params.email });
        res.status(200).json({
          success: true,
          message: 'User updated successfully',
          data: user
        });
      })
    );

    /**
     * DELETE /services/authservice/api/users/:email
     * Deletes a user account.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.email - Email of the user to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(
      '/services/authservice/api/users/:email',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        await auth.deleteUser(req.params.email);
        eventEmitter.emit('auth:user-deleted-api', { email: req.params.email });
        res.status(200).json({
          success: true,
          message: 'User deleted successfully'
        });
      })
    );

    /**
     * POST /services/authservice/api/users/:email/role
     * Assigns a role to a user.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.email - Email of the user to assign the role to
     * @param {Object} req.body - Role assignment data
     * @param {string} req.body.role - Role to assign
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/users/:email/role',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const { role } = req.body;
        await auth.addUserToRole(req.params.email, role);
        eventEmitter.emit('auth:role-assigned-api', {
          email: req.params.email,
          role
        });
        res.status(200).json({
          success: true,
          message: 'Role assigned successfully'
        });
      })
    );

    /**
     * POST /services/authservice/api/users
     * Creates a new user (admin operation).
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - User creation data
     * @param {string} req.body.email - Email address (account identity)
     * @param {string} req.body.fullName - Full display name
     * @param {string} req.body.password - Password
     * @param {string} req.body.role - User role (optional)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/users',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const user = await auth.createUser(req.body);
        eventEmitter.emit('auth:user-created-api', { email: user.email });
        res.status(201).json({
          success: true,
          message: 'User created successfully',
          data: user
        });
      })
    );

    /**
     * POST /services/authservice/api/users/batch
     * Batch creates or updates users from CSV data.
     *
     * @param {express.Request} req - Express request object
     * @param {Array<Object>} req.body.users - Array of user objects
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/users/batch',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const { users } = req.body;
        if (!Array.isArray(users)) {
          return res.status(400).json({
            success: false,
            error: 'Users must be an array'
          });
        }

        const results = await auth.batchCreateUpdateUsers(users);
        eventEmitter.emit('auth:batch-import-api', {
          created: results.created.length,
          updated: results.updated.length,
          errors: results.errors.length
        });

        res.status(200).json({
          success: results.errors.length === 0,
          data: results
        });
      })
    );

    /**
     * GET /services/authservice/api/roles
     * Lists all available roles.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/roles',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const roles = await auth.listRoles();
        res.status(200).json({
          success: true,
          data: roles,
          total: roles.length
        });
      })
    );

    /**
     * POST /services/authservice/api/roles
     * Creates a new role.
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Role creation data
     * @param {string} req.body.roleName - Role name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/roles',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const { roleName } = req.body;
        const role = await auth.createRole(roleName);
        eventEmitter.emit('auth:role-created-api', { roleName: role });
        res.status(201).json({
          success: true,
          message: 'Role created successfully',
          data: { roleName: role }
        });
      })
    );

    /**
     * DELETE /services/authservice/api/roles/:role
     * Deletes a role.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.role - Role name to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(
      '/services/authservice/api/roles/:role',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        await auth.deleteRole(req.params.role);
        eventEmitter.emit('auth:role-deleted-api', { roleName: req.params.role });
        res.status(200).json({
          success: true,
          message: 'Role deleted successfully'
        });
      })
    );

    /**
     * PUT /services/authservice/api/roles/:role/users
     * Assigns multiple users to a role.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.role - Role name
     * @param {Object} req.body - User assignment data
     * @param {Array<string>} req.body.emails - Emails of users to assign
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.put(
      '/services/authservice/api/roles/:role/users',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const { emails } = req.body;
        if (!Array.isArray(emails)) {
          return res.status(400).json({
            success: false,
            error: 'Emails must be an array'
          });
        }

        const results = {
          assigned: [],
          errors: []
        };

        for (const email of emails) {
          try {
            await auth.addUserToRole(email, req.params.role);
            results.assigned.push(email);
          } catch (error) {
            results.errors.push({ email, error: error.message });
          }
        }

        eventEmitter.emit('auth:users-assigned-api', {
          role: req.params.role,
          assigned: results.assigned.length,
          errors: results.errors.length
        });

        res.status(200).json({
          success: results.errors.length === 0,
          message: `Assigned ${results.assigned.length} users to role`,
          data: results
        });
      })
    );

    /**
     * GET /services/authservice/api/roles/:role/users
     * Gets all users in a specific role.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.role - Role name
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/roles/:role/users',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const users = await auth.getUsersInRole(req.params.role);
        res.status(200).json({
          success: true,
          data: users,
          total: users.length
        });
      })
    );

    /**
     * PUT /services/authservice/api/profile/password
     * Changes a user's password (authenticated user only).
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Password change data
     * @param {string} req.body.currentPassword - Current password
     * @param {string} req.body.newPassword - New password
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.put(
      '/services/authservice/api/profile/password',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const email = req.user?.email;
        if (!email) {
          return res.status(401).json({
            success: false,
            error: 'Not authenticated'
          });
        }

        const { currentPassword, newPassword } = req.body;
        const user = await auth.changePassword(email, currentPassword, newPassword);
        eventEmitter.emit('auth:password-changed-api', { email });

        res.status(200).json({
          success: true,
          message: 'Password changed successfully',
          data: user
        });
      })
    );

    /**
     * GET /services/authservice/api/profile/tokens
     * Lists API tokens for the authenticated user.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/profile/tokens',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const email = req.user?.email;
        if (!email) {
          return res.status(401).json({
            success: false,
            error: 'Not authenticated'
          });
        }

        const tokens = await auth.listApiTokens(email);
        res.status(200).json({
          success: true,
          data: tokens,
          total: tokens.length
        });
      })
    );

    /**
     * POST /services/authservice/api/session/exchange
     * One-time hand-off: turns a valid session token in the request body into
     * the httpOnly, SameSite=strict session cookie. Replaces the old
     * `?authToken=` query parameter, which leaked into logs and Referer headers.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.body.token - Session token
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/session/exchange',
      loginRateLimiter,
      validate({ body: { token: { type: 'string', required: true, maxLength: 512 } } }),
      asyncHandler(async (req, res) => {
        let session;
        try {
          session = await auth.validateSession(req.body.token);
        } catch (_err) {
          return res.status(401).json({ success: false, error: 'Invalid or expired session' });
        }
        if (typeof req.logIn !== 'function') {
          return res.status(503).json({ success: false, error: 'Session cookies are not configured' });
        }
        const user = await auth.getUser(session.email);
        await new Promise((resolve, reject) => {
          req.logIn(user, (err) => (err ? reject(err) : resolve()));
        });
        eventEmitter.emit('auth:session-exchanged', { email: session.email });
        res.status(200).json({ success: true });
      })
    );

    /**
     * DELETE /services/authservice/api/users/:email/tokens/:tokenId
     * Admin revocation of one of a user's personal access tokens.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.email - Owner of the token
     * @param {string} req.params.tokenId - Token to revoke
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(
      '/services/authservice/api/users/:email/tokens/:tokenId',
      requireAdminSession,
      asyncHandler(async (req, res) => {
        await auth.deleteApiToken(req.params.email, req.params.tokenId);
        eventEmitter.emit('auth:api-token-revoked-by-admin', {
          email: req.params.email,
          tokenId: req.params.tokenId,
          by: req.user?.email
        });
        res.status(200).json({ success: true, message: 'API token revoked' });
      })
    );

    /**
     * POST /services/authservice/api/profile/tokens
     * Creates a new API token for the authenticated user.
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Token creation data
     * @param {string} req.body.name - Token name/label
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/profile/tokens',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const email = req.user?.email;
        if (!email) {
          return res.status(401).json({
            success: false,
            error: 'Not authenticated'
          });
        }

        const { name, expiresInDays, expiresAt, scopes } = req.body;
        const token = await auth.createApiToken(email, name, { expiresInDays, expiresAt, scopes });
        eventEmitter.emit('auth:api-token-created-api', { email, name });

        res.status(201).json({
          success: true,
          message: 'API token created successfully',
          data: token
        });
      })
    );

    /**
     * DELETE /services/authservice/api/profile/tokens/:tokenId
     * Deletes an API token for the authenticated user.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.tokenId - Token ID to delete
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.delete(
      '/services/authservice/api/profile/tokens/:tokenId',
      requireAuthenticatedSession,
      asyncHandler(async (req, res) => {
        const email = req.user?.email;
        if (!email) {
          return res.status(401).json({
            success: false,
            error: 'Not authenticated'
          });
        }

        const { tokenId } = req.params;
        await auth.deleteApiToken(email, tokenId);
        eventEmitter.emit('auth:api-token-deleted-api', { email, tokenId });

        res.status(200).json({
          success: true,
          message: 'API token deleted successfully'
        });
      })
    );

    /**
     * POST /services/authservice/api/invitations
     * Requests a new invitation (public endpoint).
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Invitation request data
     * @param {string} req.body.name - Full name
     * @param {string} req.body.email - Email address
     * @param {string} req.body.mobile - Mobile number (optional)
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/invitations',
      invitationRateLimiter,
      validate({
        body: {
          name: { type: 'string', required: true, maxLength: 200 },
          email: { type: 'string', required: true, maxLength: 254 },
          mobile: { type: 'string', maxLength: 40 }
        }
      }),
      asyncHandler(async (req, res) => {
        try {
          const invitation = await auth.requestInvitation(req.body);
          eventEmitter.emit('auth:invitation-requested-api', { email: invitation.email, status: invitation.status });

          const pending = invitation.status === 'pending';
          res.status(201).json({
            success: true,
            message: pending
              ? 'Request received. An administrator will review it.'
              : 'Invitation created',
            data: invitation
          });
        } catch (error) {
          sendSafeError(res, error, { status: 500, eventEmitter });
        }
      })
    );

    /**
     * POST /services/authservice/api/invitations/batch
     * Batch creates invitations from a list of name/email pairs (admin only).
     *
     * @param {express.Request} req - Express request object
     * @param {Array<{name: string, email: string}>} req.body.invites - Array of invitee objects
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/invitations/batch',
      requireAdminSession,
      asyncHandler(async (req, res) => {
        const { invites } = req.body;
        if (!Array.isArray(invites)) {
          return res.status(400).json({
            success: false,
            error: 'invites must be an array'
          });
        }

        const results = await auth.batchCreateInvitations(invites);
        eventEmitter.emit('auth:invitations-batch-api', {
          created: results.created.length,
          errors: results.errors.length
        });

        res.status(200).json({
          success: results.errors.length === 0,
          data: results
        });
      })
    );

    /**
     * POST /services/authservice/api/invitations/:code/recreate
     * Recreates an invitation — generates a new code for the same invitee (admin only).
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.code - Existing invitation code to replace
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/invitations/:id/recreate',
      requireAdminSession,
      asyncHandler(async (req, res) => {
        try {
          const invitation = await auth.recreateInvitation(req.params.id);
          eventEmitter.emit('auth:invitation-recreated-api', { invitationId: invitation.id });

          res.status(200).json({
            success: true,
            message: 'Invitation recreated with new code',
            data: invitation
          });
        } catch (error) {
          sendSafeError(res, error, { status: 400, eventEmitter, format: 'json' });
        }
      })
    );

    /**
     * GET /services/authservice/api/invitations
     * Lists all invitations (admin only).
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/invitations',
      requireAdminSession,
      asyncHandler(async (req, res) => {
        const invitations = await auth.listInvitations();
        res.status(200).json({
          success: true,
          data: invitations,
          total: invitations.length
        });
      })
    );

    /**
     * GET /services/authservice/api/invitations/:code
     * Gets a specific invitation (public - for checking status).
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.code - Invitation code
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/api/invitations/:code',
      invitationRateLimiter,
      asyncHandler(async (req, res) => {
        try {
          const invitation = await auth.getInvitation(req.params.code);
          res.status(200).json({
            success: true,
            data: invitation
          });
        } catch (error) {
          sendSafeError(res, error, { status: 404, eventEmitter, format: 'json' });
        }
      })
    );

    /**
     * PUT /services/authservice/api/invitations/:code/approve
     * Approves an invitation (admin only).
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.code - Invitation code
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.put(
      '/services/authservice/api/invitations/:id/approve',
      requireAdminSession,
      asyncHandler(async (req, res) => {
        try {
          const invitation = await auth.approveInvitation(req.params.id);
          eventEmitter.emit('auth:invitation-approved-api', { invitationId: invitation.id });

          res.status(200).json({
            success: true,
            message: 'Invitation approved. Send the code to the invitee; it is shown only once.',
            data: invitation
          });
        } catch (error) {
          sendSafeError(res, error, { status: 400, eventEmitter, format: 'json' });
        }
      })
    );

    /**
     * POST /services/authservice/api/invitations/:code/redeem
     * Redeems an invitation to create a new user (public endpoint).
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.params.code - Invitation code
     * @param {Object} req.body - Redemption data
     * @param {string} req.body.password - Password for new account
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post(
      '/services/authservice/api/invitations/:code/redeem',
      invitationRateLimiter,
      validate({
        body: {
          password: { type: 'string', required: true, maxLength: 1024 }
        }
      }),
      asyncHandler(async (req, res) => {
        const { password } = req.body;
        try {
          const user = await auth.redeemInvitation(req.params.code, password);
          eventEmitter.emit('auth:invitation-redeemed-api', { email: user.email });

          res.status(201).json({
            success: true,
            message: 'Account created successfully',
            data: user
          });
        } catch (error) {
          sendSafeError(res, error, { status: 400, eventEmitter, format: 'json' });
        }
      })
    );

    /**
     * GET /services/authservice/sso/email
     * Email-based SSO redirect handler (HMAC-signed).
     * Verifies HMAC signature, creates short-lived session, redirects to return URL.
     *
     * @param {express.Request} req - Express request object
     * @param {string} req.query.email - Encoded email address
     * @param {string} req.query.sig - HMAC-SHA256 signature
     * @param {string} req.query.returnUrl - Return URL after authentication
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get(
      '/services/authservice/sso/email',
      asyncHandler(async (req, res) => {
        const { email, sig, returnUrl } = req.query;

        // Validate required parameters
        if (!email || !sig) {
          return res.status(400).json({
            success: false,
            error: 'Missing email or signature'
          });
        }

        // Decode email
        let decodedEmail;
        try {
          decodedEmail = decodeURIComponent(email);
        } catch (error) {
          return res.status(400).json({
            success: false,
            error: 'Invalid email encoding'
          });
        }

        // Verify HMAC signature
        const crypto = require('crypto');
        const ssoSecret = process.env.SSO_SECRET || options.ssoSecret;

        if (!ssoSecret) {
          return res.status(500).json({
            success: false,
            error: 'SSO not configured'
          });
        }

        const expectedSig = crypto
          .createHmac('sha256', ssoSecret)
          .update(decodedEmail)
          .digest('hex');

        if (sig !== expectedSig) {
          eventEmitter.emit('auth:sso-invalid-signature', { email: decodedEmail });
          return res.status(403).json({
            success: false,
            error: 'Invalid signature'
          });
        }

        // Validate return URL
        const allowedUrls = (process.env.SSO_ALLOWED_RETURN_URLS || options.ssoAllowedReturnUrls || '').split(',').map(u => u.trim()).filter(Boolean);
        if (returnUrl && allowedUrls.length > 0) {
          const isAllowed = allowedUrls.some(url => returnUrl.startsWith(url));
          if (!isAllowed) {
            eventEmitter.emit('auth:sso-invalid-return-url', { email: decodedEmail, returnUrl });
            return res.status(403).json({
              success: false,
              error: 'Invalid return URL'
            });
          }
        }

        try {
          // Create SSO session
          const ssoSession = await auth.createSSOSession(decodedEmail, 5);

          // Redirect to return URL with token
          const redirectUrl = returnUrl || '/services';
          const separator = redirectUrl.includes('?') ? '&' : '?';
          const finalUrl = `${redirectUrl}${separator}token=${encodeURIComponent(ssoSession.token)}`;

          eventEmitter.emit('auth:sso-redirect', { email: decodedEmail });
          res.redirect(finalUrl);
        } catch (error) {
          eventEmitter.emit('auth:sso-error', { email: decodedEmail, error: error.message });
          return res.status(401).json({
            success: false,
            error: 'SSO authentication failed'
          });
        }
      })
    );

    /**
     * GET /services/authservice/api/status
     * Returns the operational status of the authentication service.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/authservice/api/status', asyncHandler(async (req, res) => {
      const status = await auth.getStatus();
      eventEmitter.emit('api-auth-status', 'auth api running');
      res.status(200).json({
        success: true,
        data: status
      });
    }));

    /**
     * GET /services/authservice/api/branding
     * Returns branding configuration for the authentication UI.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/authservice/api/branding', asyncHandler(async (req, res) => {
      const brandingConfig = {
        appName: options.brandingConfig?.appName || 'NooblyJS',
        logoUrl: options.brandingConfig?.logoUrl || null,
        stylesheetUrl: options.brandingConfig?.stylesheetUrl || null,
        primaryColor: options.brandingConfig?.primaryColor || '#0066cc',
        secondaryColor: options.brandingConfig?.secondaryColor || '#6c757d',
        warningColor: options.brandingConfig?.warningColor || '#ffc107',
        // Where the login page sends someone with no returnUrl (e.g. when they are already signed in)
        homeUrl: options.loginSuccessRedirectUrl || '/services'
      };

      res.status(200).json({
        success: true,
        data: brandingConfig
      });
    }));

    /**
     * GET /services/authservice/api/sso-config
     * Public. Tells the login page whether to auto-launch a redirect-based SSO
     * provider (so it can bounce straight to the IdP instead of showing the
     * credential form). Enabled when Azure AD/Entra is configured via env.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/authservice/api/sso-config', asyncHandler(async (req, res) => {
      const azureConfigured = !!(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_TENANT_ID);
      res.status(200).json({
        success: true,
        data: {
          enabled: azureConfigured,
          provider: azureConfigured ? 'azure' : null,
          initiateUrl: azureConfigured ? '/services/authservice/api/azure' : null
        }
      });
    }));

    // Passport-specific routes (if available)
    if (auth.authenticateWithPassport) {
      /**
       * POST /services/authservice/api/passport/login
       * Authenticates using passport local strategy.
       */
      app.post(
        '/services/authservice/api/passport/login',
        asyncHandler(async (req, res, next) => {
          const result = await auth.authenticateWithPassport(req, res, next);

          // Where to go next: the page they were heading to > the app's loginSuccessRedirectUrl > /services
          const { returnUrl } = req.body;
          const redirectUrl = postLoginRedirect(returnUrl, options);

          res.status(200).json({
            success: true,
            message: 'Passport login successful',
            data: result,
            redirectUrl: redirectUrl
          });
        })
      );
    }

    // Google OAuth routes (if available)
    if (auth.initiateGoogleAuth) {
      /**
       * GET /services/authservice/api/google
       * Initiates Google OAuth flow.
       */
      app.get('/services/authservice/api/google', (req, res, next) => {
        auth.initiateGoogleAuth(req, res, next);
      });

      /**
       * GET /services/authservice/api/google/callback
       * Handles Google OAuth callback.
       */
      app.get(
        '/services/authservice/api/google/callback',
        asyncHandler(async (req, res, next) => {
          const result = await auth.handleGoogleCallback(req, res, next);

          // result.redirectUrl is already the page they were heading to or the app's loginSuccessRedirectUrl
          const redirectUrl = postLoginRedirect(result.redirectUrl, options);

          res.status(200).json({
            success: true,
            message: 'Google login successful',
            data: result,
            redirectUrl: redirectUrl
          });
        })
      );
    }

    // Azure AD (Microsoft Entra ID) OpenID Connect routes (if available)
    if (auth.initiateAzureAuth) {
      // The callback path is owned by the provider so the registered route and
      // the redirect URL it sends to Azure always agree.
      const azureCallbackPath = auth.callbackPath_ || '/services/authservice/openid';

      /**
       * GET /services/authservice/api/azure
       * Initiates the Azure AD OpenID Connect flow.
       */
      app.get('/services/authservice/api/azure', (req, res, next) => {
        auth.initiateAzureAuth(req, res, next);
      });

      /**
       * Handles the Azure AD OpenID Connect callback. On success the passport
       * session is established (via req.logIn inside handleAzureCallback) and the
       * browser is redirected to the post-login destination; on failure it is
       * redirected back to the login page with an error indicator.
       * @param {express.Request} req - Express request object
       * @param {express.Response} res - Express response object
       * @param {Function} next - Express next middleware function
       * @return {Promise<void>}
       */
      const handleAzureCallbackRoute = asyncHandler(async (req, res, next) => {
        let result;
        try {
          result = await auth.handleAzureCallback(req, res, next);
        } catch (err) {
          eventEmitter.emit('auth:azure-callback-error', { error: err.message });
          return res.redirect(
            '/services/authservice/views/login.html?error=' +
            encodeURIComponent('Azure AD authentication failed')
          );
        }

        // result.redirectUrl is the page they were heading to (the sanitized returnUrl) or the app's
        // loginSuccessRedirectUrl; /services only when neither is set.
        const redirectUrl = postLoginRedirect(result.redirectUrl, options);
        res.redirect(redirectUrl);
      });

      /**
       * POST/GET {azureCallbackPath} (default /services/authservice/openid)
       * Handles the Azure AD OpenID Connect callback (the registered redirect
       * URI). The strategy uses response_mode=form_post (POST); GET is also
       * accepted for query-mode setups.
       */
      app.post(azureCallbackPath, handleAzureCallbackRoute);
      app.get(azureCallbackPath, handleAzureCallbackRoute);
    }

    if (analytics) {
      app.get(
        '/services/authservice/api/analytics',
        requireAuthenticatedSession,
        asyncHandler(async (req, res) => {
          const limit = capLimit(parseInt(req.query.limit, 10));
          const recentLimit = capLimit(parseInt(req.query.recentLimit, 10));
          res.status(200).json({
            overview: analytics.getOverview(),
            topUsers: analytics.getTopUsers(Number.isNaN(limit) ? 10 : limit),
            topRecent: analytics.getTopByRecency(Number.isNaN(recentLimit) ? 100 : recentLimit)
          });
        })
      );
    }

    // Error handling middleware
    app.use('/services/authservice/api', (error, req, res, next) => {
      eventEmitter.emit('auth:api-error', {
        error: error.message,
        path: req.path
      });

      // P1-2: provider validation errors ("User not found", "Invalid
      // credentials") are client-safe 4xx. System errors (fs/network: they
      // carry `syscall` or an E* `code`) and explicit 5xx are server faults
      // whose messages may contain paths, so they get a generic 500.
      const explicitStatus = Number(error.statusCode || error.status) || 0;
      const isSystemError = Boolean(error.syscall || /^E[A-Z]+$/.test(String(error.code || '')));
      const status = explicitStatus >= 400
        ? explicitStatus
        : (isSystemError ? 500 : 400);
      res.status(status).json({
        success: false,
        error: status >= 500 ? 'Internal Server Error' : (error.message || 'Authentication error')
      });
    });

    /**
     * GET /services/authservice/api/settings
     * Retrieves the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.get('/services/authservice/api/settings', asyncHandler(async (req, res) => {
      try {
        const settings = await auth.getSettings();
        res.status(200).json(settings);
      } catch (err) {
        eventEmitter.emit('auth:settings-error', { error: err.message });
        res.status(500).json({ error: 'Failed to retrieve settings' });
      }
    }));

    /**
     * POST /services/authservice/api/settings
     * Saves the settings
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    app.post('/services/authservice/api/settings', asyncHandler(async (req, res) => {
      const message = req.body;
      if (message) {
        try {
          await auth.saveSettings(message);
          eventEmitter.emit('auth:settings-updated', { timestamp: Date.now() });
          res.status(200).send('OK');
        } catch (err) {
          eventEmitter.emit('auth:settings-save-error', { error: err.message });
          sendSafeError(res, err, { status: 500, eventEmitter, format: 'send' });
        }
      } else {
        res.status(400).send('Bad Request: Missing settings');
      }
    }));

    // ===== Secure Email Authentication Routes (Teams/Edge Extensions) =====

    /**
     * POST /services/authservice/api/secure-email/login
     * Authenticates a user with email and secure key.
     * Returns a bearer token for use with all authenticated endpoints.
     * No authentication required for this endpoint.
     *
     * @param {express.Request} req - Express request object
     * @param {Object} req.body - Authentication data
     * @param {string} req.body.email - User email address
     * @param {string} req.body.secureKey - Secure API key for the email
     * @param {express.Response} res - Express response object
     * @return {void}
     */
    if (auth.authenticateWithSecureEmail) {
      app.post(
        '/services/authservice/api/secure-email/login',
        asyncHandler(async (req, res) => {
          const { email, secureKey } = req.body;

          if (!email || !secureKey) {
            return res.status(400).json({
              success: false,
              error: 'Bad Request',
              message: 'Email and secureKey are required'
            });
          }

          try {
            const result = await auth.authenticateWithSecureEmail(email, secureKey);

            // Establish Passport session if available
            if (result.user && req.logIn) {
              await new Promise((resolve, reject) => {
                req.logIn(result.user, (err) => {
                  if (err) {
                    eventEmitter.emit('auth:passport-error', { error: err.message });
                    return reject(err);
                  }
                  resolve();
                });
              });
            }

            res.json({
              success: true,
              message: 'Authentication successful',
              data: result
            });
          } catch (error) {
            res.status(401).json({ success: false, error: 'Unauthorized' });
          }
        })
      );

      /**
       * POST /services/authservice/api/secure-email/users
       * Adds a new secure email user to the system.
       * Requires API key authentication.
       *
       * @param {express.Request} req - Express request object
       * @param {Object} req.body - User data
       * @param {string} req.body.email - User email address
       * @param {string} req.body.secureKey - Secure key for authentication
       * @param {string} req.body.fullName - Full display name (optional, defaults to email)
       * @param {string} req.body.role - User role (optional, defaults to 'user')
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.post(
        '/services/authservice/api/secure-email/users',
        authMiddleware || ((req, res, next) => next()),
        asyncHandler(async (req, res) => {
          const { email, secureKey, fullName, role } = req.body;

          if (!email || !secureKey) {
            return res.status(400).json({
              success: false,
              error: 'Bad Request',
              message: 'Email and secureKey are required'
            });
          }

          try {
            const user = await auth.addSecureEmailUser(email, secureKey, fullName, role);

            res.status(201).json({
              success: true,
              message: 'Secure email user added successfully',
              data: user
            });
          } catch (error) {
            res.status(400).json({ success: false, error: 'Bad Request' });
          }
        })
      );

      /**
       * GET /services/authservice/api/secure-email/users
       * Lists all secure email users.
       * Requires API key authentication.
       *
       * @param {express.Request} req - Express request object
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.get(
        '/services/authservice/api/secure-email/users',
        authMiddleware || ((req, res, next) => next()),
        asyncHandler(async (req, res) => {
          try {
            const users = await auth.listSecureEmailUsers();

            res.json({
              success: true,
              message: 'Secure email users retrieved successfully',
              data: { users }
            });
          } catch (error) {
            res.status(500).json({ success: false, error: 'Server Error' });
          }
        })
      );

      /**
       * DELETE /services/authservice/api/secure-email/users/:email
       * Removes a secure email user from the system.
       * Requires API key authentication.
       *
       * @param {express.Request} req - Express request object
       * @param {string} req.params.email - Email address of user to remove
       * @param {express.Response} res - Express response object
       * @return {void}
       */
      app.delete(
        '/services/authservice/api/secure-email/users/:email',
        authMiddleware || ((req, res, next) => next()),
        asyncHandler(async (req, res) => {
          const { email } = req.params;

          if (!email) {
            return res.status(400).json({
              success: false,
              error: 'Bad Request',
              message: 'Email is required'
            });
          }

          try {
            await auth.removeSecureEmailUser(email);

            res.json({
              success: true,
              message: 'Secure email user removed successfully',
              data: { email }
            });
          } catch (error) {
            res.status(404).json({ success: false, error: 'Not Found' });
          }
        })
      );
    }
  }
};

/**
 * Creates middleware that accepts either a valid session token issued by the auth
 * provider or a valid API key via the existing auth middleware.
 *
 * @param {Object} authProvider - Auth provider instance
 * @param {Function} apiKeyMiddleware - Middleware enforcing API keys
 * @returns {Function} Express middleware
 */
function createSessionAwareAuthGuard(authProvider, apiKeyMiddleware) {
  return async (req, res, next) => {
    const token = extractAuthToken(req);

    if (token) {
      try {
        const session = await authProvider.validateSession(token);
        req.authToken = token;
        req.authSession = session;
        if (!req.user) {
          const userRoles = Array.isArray(session.roles) ? session.roles : [session.role || 'user'];
          req.user = {
            id: session.userId,
            email: session.email,
            fullName: session.fullName,
            roles: userRoles
          };
        }
        return next();
      } catch (error) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired session token',
          message: 'Session validation failed'
        });
      }
    }

    // Accept an established Passport session. The login route calls
    // req.logIn(), so an authenticated browser carries the session cookie
    // automatically — this works even when localStorage is unavailable
    // (e.g. blocked by browser tracking prevention).
    if (typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user) {
      return next();
    }

    if (typeof apiKeyMiddleware === 'function') {
      return apiKeyMiddleware(req, res, next);
    }

    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Provide a valid session token or API key.'
    });
  };
}

/**
 * Extracts a session token from the incoming request.
 *
 * @param {import('express').Request} req - Express request
 * @returns {?string} Session token if present
 */
function extractAuthToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (typeof authHeader === 'string') {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
      return bearerMatch[1].trim();
    }

    const tokenMatch = authHeader.match(/^Token\s+(.+)$/i);
    if (tokenMatch) {
      return tokenMatch[1].trim();
    }
  }

  if (typeof req.headers['x-auth-token'] === 'string') {
    return req.headers['x-auth-token'].trim();
  }

  if (req.body && typeof req.body === 'object' && typeof req.body.authToken === 'string') {
    return req.body.authToken;
  }

  if (req.session && typeof req.session.authToken === 'string') {
    return req.session.authToken;
  }

  return null;
}
