'use strict';

/**
 * @fileoverview Authentication middleware for protecting routes
 * Provides middleware factory for requiring user authentication on protected routes.
 * Handles unauthenticated users by redirecting to login with referrer tracking.
 */

/**
 * Creates authentication middleware that checks if user is authenticated.
 * If user is not authenticated, redirects to login page with return URL tracking.
 *
 * @param {Object} [options={}] - Configuration options
 * @param {string} [options.loginPath='/services/authservice/views/login.html'] - Path to login page
 * @param {boolean} [options.saveReferer=true] - Whether to save the original URL for post-login redirect
 * @returns {Function} Express middleware function
 *
 * @description
 * How it works:
 * 1. User accesses protected route (e.g., /app/index.html)
 * 2. Middleware checks: req.isAuthenticated() (Passport session check)
 * 3. If NOT authenticated:
 *    - Captures original URL (e.g., /app/index.html)
 *    - Stores in session.returnUrl as backup
 *    - Redirects to login with: ?returnUrl=%2Fapp%2Findex.html
 * 4. Login page displays and user enters credentials
 * 5. Login API (/services/authservice/api/login) validates credentials
 * 6. API calls req.logIn() to establish Passport session
 * 7. Frontend reads returnUrl from query parameter
 * 8. Frontend redirects back to original URL
 * 9. Middleware checks again: req.isAuthenticated() now returns TRUE
 * 10. Access granted to protected content
 *
 * @example
 * // Create middleware with default authservice login page
 * const requireAuth = authservice.createAuthMiddleware();
 * app.use('/app', requireAuth, express.static(__dirname + '/public/app'));
 *
 * @example
 * // Create middleware with custom login path
 * const requireAuth = authservice.createAuthMiddleware({
 *   loginPath: '/custom-login.html',
 *   saveReferer: true
 * });
 * app.use('/protected', requireAuth, handler);
 */
function createAuthMiddleware(options = {}) {
  const loginPath = options.loginPath || '/services/authservice/views/login.html';
  const saveReferer = options.saveReferer !== false; // Default to true

  return (req, res, next) => {
    // Check if user is authenticated
    if (req.isAuthenticated && req.isAuthenticated()) {
      // User is authenticated, proceed to next middleware/handler
      return next();
    }

    // User is not authenticated - redirect to login
    // Preserve the original URL so user can be redirected back after login
    if (saveReferer) {
      const returnUrl = req.originalUrl || req.url;
      // Store returnUrl in session as backup
      if (req.session) {
        req.session.returnUrl = returnUrl;
      }

      // Redirect with returnUrl query parameter (matches login page expectations)
      return res.redirect(`${loginPath}?returnUrl=${encodeURIComponent(returnUrl)}`);
    }

    // Simple redirect without referrer tracking
    res.redirect(loginPath);
  };
}

/**
 * Creates authentication middleware with custom response handling.
 * Allows applications to handle unauthenticated requests with custom logic
 * (e.g., JSON responses for APIs instead of redirects).
 *
 * @param {Object} [options={}] - Configuration options
 * @param {Function} [options.onUnauthorized] - Custom handler for unauthenticated requests
 *   Called with (req, res, next) if user is not authenticated
 * @returns {Function} Express middleware function
 *
 * @example
 * // Return JSON error for API endpoints
 * const requireAuth = createAuthMiddlewareWithHandler({
 *   onUnauthorized: (req, res, next) => {
 *     res.status(401).json({
 *       error: 'Authentication required',
 *       message: 'Please login to access this resource'
 *     });
 *   }
 * });
 * app.use('/api/protected', requireAuth, apiHandler);
 */
function createAuthMiddlewareWithHandler(options = {}) {
  const onUnauthorized = options.onUnauthorized ||
    ((req, res) => res.redirect('/services/authservice/views/login.html'));

  return (req, res, next) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return next();
    }

    // Call custom handler for unauthorized users
    onUnauthorized(req, res, next);
  };
}

module.exports = {
  createAuthMiddleware,
  createAuthMiddlewareWithHandler
};
