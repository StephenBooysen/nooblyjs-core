'use strict';

/**
 * @fileoverview Authenticated services middleware
 * Protects /services routes by validating sessions through the authservice.
 *
 * @module authservice/middleware/services
 */

const { matchesAnyKey } = require('./apiKey');
const { normalizeApiKeys } = require('../modules/permissions');

/**
 * Creates authentication middleware for protecting the services page.
 * Validates user session tokens, enforces admin role, and redirects unauthorized users.
 *
 * @param {Object} serviceRegistry - The service registry instance
 * @returns {Function} Express middleware function
 */
function createServicesAuthMiddleware(serviceRegistry) {
  return async (req, res, next) => {
    try {
      // STEP 1: Check if path is public (bypasses all auth checks)
      const isPublicPath = isPathPublic(req.path, req.method);
      if (isPublicPath) {
        return next();
      }

      // STEP 2: Special handling for login/register pages
      if (req.path.includes('/login') || req.path.includes('/register')) {
        if (req.path.includes('/login')) {
          // Feature 23: never from the query string.
          const token = (req.headers.authorization || '').startsWith('Bearer ')
            ? req.headers.authorization.substring(7)
            : (req.session && req.session.authToken);

          if (token) {
            try {
              const authService = serviceRegistry.authservice();
              const session = await authService.validateSession(token);

              // Only redirect if user is authenticated AND has admin role
              const sessionRoles = Array.isArray(session.roles) ? session.roles : [session.role || ''];
              if (session && session.email && sessionRoles.includes('admin')) {
                return res.redirect('/services/');
              }
            } catch (error) {
              // Ignore invalid tokens so login page can render
            }
          }
        }
        return next();
      }

      // STEP 3: Check Passport session authentication first
      if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role || ''];
        if (!userRoles.includes('admin')) {
          return redirectToInvalid(req, res);
        }
        // User is authenticated via Passport session and has admin role
        return next();
      }

      // STEP 3b: Accept a valid API key for programmatic (non-browser) access
      // to the admin portal. P1-5: portal access requires an *admin-scoped* key
      // when one is configured (securityConfig.servicesAuth.apiKeys /
      // globalOptions.adminApiKeys); general data-plane API keys no longer grant
      // portal access. If no admin keys are configured we fall back to the
      // general keys for backward compatibility. Comparison is constant-time.
      const apiKey = extractApiKey(req);
      if (apiKey) {
        const adminKeys = getConfiguredAdminApiKeys(serviceRegistry);
        // M-1 / feature 19: in production a data-plane key never opens the
        // portal. Outside production the old fallback remains for convenience.
        const portalKeys = adminKeys.length > 0
          ? adminKeys
          : (process.env.NODE_ENV === 'production' ? [] : getConfiguredApiKeys(serviceRegistry));
        if (matchesAnyKey(apiKey, portalKeys)) {
          req.apiKey = apiKey;
          return next();
        }
      }

      // STEP 4: Extract token from multiple sources
      let token = null;
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }

      if (!token && req.session && req.session.authToken) {
        token = req.session.authToken;
      }

      // STEP 5: Validate token and check admin role
      if (token) {
        try {
          const authService = serviceRegistry.authservice();
          const session = await authService.validateSession(token);

          if (session && session.email) {
            // Check for admin role
            const sessionRoles = Array.isArray(session.roles) ? session.roles : [session.role || ''];
            if (!sessionRoles.includes('admin')) {
              return redirectToInvalid(req, res);
            }

            // User is authenticated and has admin role
            req.user = {
              id: session.userId,
              email: session.email,
              fullName: session.fullName,
              roles: sessionRoles
            };
            req.sessionData = session;

            // Store token in session for subsequent requests
            if (req.session) {
              req.session.authToken = token;
            }

            return next();
          }
        } catch (error) {
          // Token validation failed, fall through to unauthenticated handling
        }
      }

      // STEP 6: No valid credential. Browsers go to the login page (which
      // sends them back here afterwards); API callers get 401. Feature 23
      // removed the old client-side page that re-sent a script-held token
      // in the URL.
      // For API requests or other non-HTML requests, redirect to login
      return redirectToLogin(req, res);
    } catch (error) {
      return redirectToLogin(req, res);
    }
  };
}

/**
 * Checks if a path is public and should bypass authentication.
 * @param {string} path - The request path (relative to /services mount point)
 * @param {string=} method - The HTTP method (used to gate routes whose public vs
 *   admin status depends on the verb, e.g. the bare /invitations path)
 * @returns {boolean} True if path is public
 */
function isPathPublic(path, method) {
  // Auth views and pages
  if (path.startsWith('/authservice/views/')) return true;

  // Invitation redemption page — invitees are not logged in yet.
  if (path === '/authservice/redeem-invitation') return true;

  // Browser-friendly GET logout route — must be reachable without auth so
  // expired sessions can still hit it and end up on the login page.
  if (path === '/authservice/logout') return true;

  // Auth APIs that don't require login
  if (path.startsWith('/authservice/api/login')) return true;
  if (path.startsWith('/authservice/api/logout')) return true;
  if (path.startsWith('/authservice/api/validate')) return true;
  if (method === 'POST' && path === '/authservice/api/session/handoff') return true;
  if (path === '/authservice/api/session') return true;
  if (path.startsWith('/authservice/api/register')) return true;
  if (path.startsWith('/authservice/api/branding')) return true;
  if (path.startsWith('/authservice/api/auth/')) return true;

  // Azure AD / Entra SSO: the initiate (/api/azure) and the IdP callback
  // (/openid) must be reachable WITHOUT an existing session — that is exactly
  // who is signing in. /api/sso-config tells the login page whether to
  // auto-launch SSO. Without these, the guard would bounce the unauthenticated
  // user to the login page, which auto-redirects back to the initiate — an
  // infinite redirect loop.
  if (path.startsWith('/authservice/api/azure')) return true;
  if (path.startsWith('/authservice/openid')) return true;
  if (path.startsWith('/authservice/api/sso-config')) return true;

  // Public invitation REQUEST endpoint: a logged-out visitor submits the
  // request-invitation form to obtain a code. It shares its path with the admin
  // "list all invitations" route (GET /invitations), so gate on the verb — only
  // POST is public; GET stays behind the admin guard below.
  if (method === 'POST' && path === '/authservice/api/invitations') {
    return true;
  }

  // Public invitation endpoints: fetch a single invitation and redeem it.
  // Admin invitation endpoints (list-all, batch, recreate, approve) are NOT
  // matched here and keep their own route-level authentication guard.
  if (/^\/authservice\/api\/invitations\/[^/]+(\/redeem)?$/.test(path)
      && path !== '/authservice/api/invitations/batch') {
    return true;
  }

  // Self-service profile API (manage your OWN password and API tokens). These
  // are PERSONAL endpoints — a regular, non-admin user must be able to change
  // their password and create/list/revoke their own `dtk_` tokens. They bypass
  // the /services portal *admin* guard but are NOT unauthenticated: every
  // /authservice/api/profile/* route applies requireAuthenticatedSession and
  // scopes strictly to req.user.email (see src/authservice/routes/index.js).
  // Without this carve-out the admin gate 403s ("Insufficient privileges") any
  // non-admin trying to manage their own tokens. Mirrors the /filing/api/ case.
  if (path.startsWith('/authservice/api/profile/')) return true;

  // UI framework assets (used by all pages)
  if (path.startsWith('/uiservice/')) return true;

  // Filing API is consumed by regular users (web wiki, Teams, Chrome extension) to
  // download/upload documents, so it bypasses the /services portal *admin* guard
  // (non-admin users must still be able to read documents). It is NOT
  // unauthenticated: the filing router applies the shared API-key middleware
  // (which also accepts a valid Passport session) to every /services/filing/api
  // route — see src/filing/routes/index.js (requireApiAuth).
  if (path.startsWith('/filing/api/')) return true;

  // Client-side script library endpoints (e.g., /services/logging/scripts, /services/notifying/scripts)
  // These serve JS libraries used by the dashboard UI - safe to expose
  if (/^\/[a-z]+\/scripts(\/.*)?$/.test(path)) return true;

  // Status endpoints and static assets are only public for reads. Matching on
  // the path alone let any method through, e.g. a non-admin session could
  // PUT /workflow/api/definitions/x.js or DELETE /caching/api/delete/k.css
  // past the admin guard.
  const isRead = method === 'GET' || method === 'HEAD';

  // Health check endpoints
  if (isRead && path.endsWith('/status')) return true;

  // Static assets (CSS, JS, images, fonts)
  const staticAssetRegex = /\.(css|js|png|svg|ico|jpg|jpeg|gif|woff|woff2|ttf|eot)$/;
  if (isRead && staticAssetRegex.test(path)) return true;

  return false;
}

/**
 * Extracts an API key from the request, checking the locations supported by
 * the API key middleware: the x-api-key / api-key headers, an Authorization
 * header (ApiKey or Bearer scheme), and the api_key query parameter.
 *
 * @param {Object} req - Express request object
 * @returns {?string} The API key if present, otherwise null
 */
function extractApiKey(req) {
  let key = req.headers['x-api-key'] || req.headers['api-key'];

  if (!key && typeof req.headers.authorization === 'string') {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('ApiKey ')) {
      key = authHeader.substring(7);
    } else if (authHeader.startsWith('Bearer ')) {
      // A Bearer value may be an API key or a session token; if it is not a
      // configured API key the caller falls through to session validation.
      key = authHeader.substring(7);
    }
  }

  // P1-5: the api_key query parameter is no longer accepted (it leaks into
  // logs, history and Referer headers); keys must be supplied via headers.

  return key || null;
}

/**
 * Resolves the list of admin-scoped API keys permitted to access the /services
 * portal. Returns an empty array when none are configured (callers then fall
 * back to the general API keys for backward compatibility).
 *
 * @param {Object} serviceRegistry - The service registry instance
 * @returns {string[]} Array of admin API keys (possibly empty)
 */
function getConfiguredAdminApiKeys(serviceRegistry) {
  if (!serviceRegistry) return [];

  const fromGlobal = serviceRegistry.globalOptions
    && serviceRegistry.globalOptions.adminApiKeys;
  if (Array.isArray(fromGlobal)) return normalizeApiKeys(fromGlobal).keys;

  const fromSecurity = serviceRegistry.securityConfig
    && serviceRegistry.securityConfig.servicesAuth
    && serviceRegistry.securityConfig.servicesAuth.apiKeys;
  return Array.isArray(fromSecurity) ? normalizeApiKeys(fromSecurity).keys : [];
}

/**
 * Resolves the list of configured API keys from the service registry.
 *
 * @param {Object} serviceRegistry - The service registry instance
 * @returns {string[]} Array of valid API keys (empty when none configured)
 */
function getConfiguredApiKeys(serviceRegistry) {
  if (!serviceRegistry) return [];

  const fromGlobal = serviceRegistry.globalOptions && serviceRegistry.globalOptions.apiKeys;
  if (Array.isArray(fromGlobal)) return fromGlobal;

  const fromSecurity = serviceRegistry.securityConfig
    && serviceRegistry.securityConfig.apiKeyAuth
    && serviceRegistry.securityConfig.apiKeyAuth.apiKeys;
  return Array.isArray(fromSecurity) ? fromSecurity : [];
}

/**
 * Redirects user to the "insufficient privileges" page.
 * For API requests, returns a JSON error response instead of redirecting.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function redirectToInvalid(req, res) {
  // For API requests (no HTML in accept header), return JSON error
  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) {
    return res.status(403).json({
      success: false,
      error: 'Insufficient privileges',
      message: 'Administrator role is required to access the services portal'
    });
  }

  // For HTML requests, redirect to invalid page
  res.redirect('/services/authservice/views/invalid.html');
}

/**
 * Redirects user to login page with return URL.
 * API/non-HTML requests get a 401 JSON response instead of an HTML redirect
 * (N-8), mirroring redirectToInvalid.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
function redirectToLogin(req, res) {
  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Log in or supply a valid API key to access the services API'
    });
  }

  const returnUrl = encodeURIComponent(req.originalUrl);
  res.redirect(`/services/authservice/views/login.html?returnUrl=${returnUrl}`);
}

module.exports = {
  createServicesAuthMiddleware
};
