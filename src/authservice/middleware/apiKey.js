'use strict';

const { normalizeKeyEntries, findKeyEntry } = require('../modules/permissions');

/**
 * @fileoverview API Key Authentication Middleware
 * Provides secure API key validation for all NooblyJS service endpoints.
 *
 * @module authservice/middleware/apiKey
 */

const crypto = require('crypto');

/**
 * Prefix carried by user-issued personal access tokens. Used to cheaply
 * distinguish a user token from a static API key before attempting the
 * (async) token validation path. Must match AuthBase.TOKEN_PREFIX.
 * @const {string}
 */
const USER_TOKEN_PREFIX = 'dtk_';

/**
 * Constant-time string comparison that does not leak length via early return
 * timing differences within the same-length case.
 * @param {string} a First value.
 * @param {string} b Second value.
 * @return {boolean} True if the values are equal.
 */
function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Run a same-length compare to keep timing roughly uniform, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Checks a provided key against a list of valid keys in constant time.
 * Every candidate is compared (no short-circuit) so timing does not reveal
 * which key matched or how many were checked.
 * @param {string} provided The presented API key.
 * @param {string[]} validKeys Configured valid keys.
 * @return {boolean} True if the provided key matches any valid key.
 */
function matchesAnyKey(provided, validKeys) {
  if (!provided || !Array.isArray(validKeys)) return false;
  let matched = false;
  for (const candidate of validKeys) {
    if (timingSafeEqualStr(provided, candidate)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * API Key Authentication Middleware
 *
 * Validates API keys supplied via headers or query parameters. Emits
 * auth events when an event emitter is provided through the service registry.
 *
 * @param {Object} [options] - Configuration options
 * @param {string[]} [options.apiKeys] - Array of valid API keys
 * @param {boolean} [options.requireApiKey=true] - Whether API key is required
 * @param {string[]} [options.excludePaths] - Paths to exclude from API key validation
 * @param {function(string): Promise<Object>} [options.validateApiToken] - Optional
 *     async validator for user-issued personal access tokens (the `dtk_` prefix).
 *     Receives the raw token and resolves to `{ email, roles, user, token }` when
 *     valid, or rejects/returns falsy when not. When supplied, a presented `dtk_`
 *     token is accepted as a credential equivalent to the owning user.
 * @param {Object} [eventEmitter] - Event emitter for logging
 * @returns {Function} Express middleware function
 */
function createApiKeyAuthMiddleware(options = {}, eventEmitter = null) {
  const {
    apiKeys = [],
    requireApiKey = true,
    excludePaths = ['/services/*/status', '/services/', '/services/*/views/*'],
    validateApiToken = null,
    validateSession = null
  } = options;

  // Keys may be plain strings (full access) or { key, name, scopes } objects (feature 19).
  const keyEntries = normalizeKeyEntries(apiKeys);

  return (req, res, next) => {
    if (!requireApiKey) {
      return next();
    }

    // Match exclude patterns against the FULL request path, not req.path.
    // When this middleware is mounted on a sub-path (e.g.
    // app.use('/services/logging/api', mw)), Express strips the mount prefix
    // from req.path (leaving '/status'), which would break patterns like
    // '/services/*/status'. Reconstructing baseUrl + path (falling back to
    // originalUrl without the query string) makes exclusion correct whether the
    // middleware is mounted at the app root or on a prefix.
    const fullPath = (typeof req.baseUrl === 'string' && req.baseUrl.length > 0)
      ? req.baseUrl + req.path
      : (req.originalUrl ? req.originalUrl.split('?')[0] : req.path);

    const shouldExclude = excludePaths.some(pattern => {
      // Escape regex metacharacters, then treat '*' as a wildcard segment.
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
      return regex.test(fullPath) || regex.test(req.path);
    });

    if (shouldExclude) {
      return next();
    }

    let apiKey = req.headers['x-api-key']
      || req.headers['api-key'];

    if (!apiKey && req.headers.authorization) {
      const authHeader = req.headers.authorization;

      if (authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.substring(7);
      }

      if (authHeader.startsWith('ApiKey ')) {
        apiKey = authHeader.substring(7);
      }
    }

    // P1-5: credentials are accepted via headers only. The api_key query
    // parameter is no longer honoured because it leaks into access logs,
    // browser history and Referer headers.

    const emitSuccess = (extra) => {
      if (eventEmitter) {
        eventEmitter.emit('api-auth-success', {
          ip: req.ip,
          path: req.path,
          method: req.method,
          ...extra
        });
      }
    };
    const emitFailure = (reason, extra) => {
      if (eventEmitter) {
        eventEmitter.emit('api-auth-failure', {
          reason,
          ip: req.ip,
          path: req.path,
          method: req.method,
          ...extra
        });
      }
    };
    const rejectInvalidToken = (presented, err) => {
      emitFailure('invalid-token', {
        tokenPrefix: presented.substring(0, 12) + '...',
        ...(err ? { error: err.message } : {})
      });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired API token.',
        code: 'INVALID_TOKEN'
      });
    };

    // Validates `token` as a browser session token via the injected
    // validateSession hook. On success, populates req.user and calls next().
    // On failure (or when no validator is configured), invokes onFailure() so
    // the caller controls the exact rejection response. Always terminates the
    // request (returns a promise); the caller should `return` it.
    const attemptSessionToken = (token, onFailure) => {
      if (typeof validateSession !== 'function' || !token) {
        return onFailure();
      }
      return Promise.resolve()
        .then(() => validateSession(token))
        .then((session) => {
          if (!session || !session.email) {
            return onFailure();
          }
          const roles = Array.isArray(session.roles)
            ? session.roles
            : (session.role ? [session.role] : []);
          if (!req.user) {
            req.user = {
              id: session.userId,
              email: session.email,
              fullName: session.fullName,
              roles
            };
          }
          req.sessionData = session;
          emitSuccess({ via: 'session-token', email: session.email });
          return next();
        })
        .catch(() => onFailure());
    };

    if (apiKey) {
      // 1. Static API key (machine/admin credential). Synchronous, unchanged.
      const keyEntry = findKeyEntry(apiKey, keyEntries);
      if (keyEntry) {
        emitSuccess({ keyPrefix: apiKey.substring(0, 8) + '...' });
        req.apiKey = apiKey;
        req.apiKeyScopes = keyEntry.scopes;
        return next();
      }

      // 2. User-issued personal access token. Only this branch is async; every
      // other path stays synchronous so existing behaviour is unchanged when no
      // token validator is configured.
      if (typeof validateApiToken === 'function' && apiKey.startsWith(USER_TOKEN_PREFIX)) {
        const presentedToken = apiKey;
        Promise.resolve()
          .then(() => validateApiToken(presentedToken))
          .then((result) => {
            if (!result || !result.email) {
              return rejectInvalidToken(presentedToken);
            }

            // The token acts as its owner, carrying the user's live roles.
            req.authToken = presentedToken;
            req.tokenAuth = true;
            req.userEmail = result.email;
            req.userRoles = result.roles || (result.user && result.user.roles) || [];
            req.apiTokenId = result.token && result.token.id;
            if (!req.user) {
              req.user = result.user || { email: result.email, roles: req.userRoles };
            }

            emitSuccess({ via: 'token', email: result.email, tokenId: req.apiTokenId });
            return next();
          })
          .catch((err) => rejectInvalidToken(presentedToken, err));
        return;
      }

      // 3. Credential presented but matched no known key or token. A Bearer
      // value may be a browser *session* token (the dashboards send the session
      // token as Bearer), so try validating it as a session before rejecting.
      if (typeof validateSession === 'function') {
        return attemptSessionToken(apiKey, () => {
          emitFailure('invalid-api-key', { providedKey: apiKey.substring(0, 8) + '...' });
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid API key provided.',
            code: 'INVALID_API_KEY'
          });
        });
      }

      emitFailure('invalid-api-key', { providedKey: apiKey.substring(0, 8) + '...' });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key provided.',
        code: 'INVALID_API_KEY'
      });
    }

    // 4. No credential — accept an authenticated browser session in lieu of an
    // API key. Service dashboards are served to a logged-in admin (enforced by
    // the /services portal guard); their fetch() calls carry the session cookie
    // rather than an API key. Programmatic callers with no session still need a
    // key or token.
    if (typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user) {
      emitSuccess({ via: 'session' });
      return next();
    }

    // 5. No API key and no Passport session — accept a valid browser session
    // token. The service dashboards authenticate with an `authToken` session
    // token rather than a Passport login session; their same-origin fetch()
    // calls carry it via the session cookie or the authToken query param (the
    // Authorization: Bearer form is handled by the apiKey branch above). An
    // invalid or absent token still yields the 401 below.
    if (typeof validateSession === 'function') {
      let sessionToken = null;
      if (req.session && typeof req.session.authToken === 'string') {
        sessionToken = req.session.authToken;
      }

      if (sessionToken) {
        return attemptSessionToken(sessionToken, () => {
          emitFailure('invalid-session');
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired session.',
            code: 'INVALID_SESSION'
          });
        });
      }
    }

    emitFailure('missing-api-key');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key is required. Provide it via the x-api-key header or an Authorization header.',
      code: 'MISSING_API_KEY'
    });
  };
}

/**
 * Generate a secure API key
 * @param {number} [length=32] - Length of the API key
 * @returns {string} Generated API key
 */
function generateApiKey(length = 32) {
  const crypto = require('crypto');
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = crypto.randomBytes(length);
  let apiKey = '';

  // Rejection-free mapping into the charset via modulo. The charset length (62)
  // is close enough to 256 that modulo bias is negligible for API key entropy,
  // and every byte comes from a CSPRNG (crypto.randomBytes).
  for (let i = 0; i < length; i++) {
    apiKey += charset[randomBytes[i] % charset.length];
  }

  return apiKey;
}

/**
 * Validate API key format
 * @param {string} apiKey - The API key to validate
 * @returns {boolean} Whether the API key format is valid
 */
function isValidApiKeyFormat(apiKey) {
  if (typeof apiKey !== 'string') {
    return false;
  }

  return /^[A-Za-z0-9]{16,}$/.test(apiKey);
}

module.exports = {
  createApiKeyAuthMiddleware,
  generateApiKey,
  isValidApiKeyFormat,
  matchesAnyKey,
  timingSafeEqualStr
};
