/**
 * @fileoverview Session and token hygiene for `/services` (feature 23).
 *
 * - `createCookieSessionHygiene()` applies the idle and absolute timeouts to
 *   cookie (Passport) sessions, and ends a cookie session that was opened
 *   before the user's password or roles last changed (`sessionsValidAfter`).
 * - `createOriginCheck()` refuses state-changing requests that ride on the
 *   session cookie when their `Origin` (or `Referer`) is another site. This is
 *   defence in depth behind `SameSite=strict`.
 * - `referrerPolicy()` sends `Referrer-Policy: no-referrer` on dashboards.
 *
 * @module authservice/middleware/sessionHygiene
 */

'use strict';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Ends the cookie session's login on this request and in the store.
 * @param {express.Request} req - Request
 */
function endCookieLogin(req) {
  if (req.session) {
    delete req.session.passport;
    delete req.session.authToken;
    delete req.session.loginAt;
    delete req.session.lastSeenAt;
  }
  req.user = null;
}

/**
 * Creates the cookie-session hygiene middleware.
 *
 * @param {Object} opts - Options
 * @param {function(): ?Object} opts.getAuth - Returns the auth provider, if
 *     one exists (never creates one)
 * @param {EventEmitter=} opts.eventEmitter - Receives expiry events
 * @return {function(express.Request, express.Response, Function): void}
 */
function createCookieSessionHygiene({ getAuth, eventEmitter }) {
  return (req, res, next) => {
    const session = req.session;
    const user = req.user;
    if (!session || !user || typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
      return next();
    }
    const auth = getAuth();
    const now = Date.now();
    if (!session.loginAt) session.loginAt = now;

    const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
    const cfg = auth && typeof auth.sessionConfig_ === 'function'
      ? auth.sessionConfig_()
      : { absoluteTimeoutMs: 24 * 60 * 60 * 1000 };
    const idleMs = auth && typeof auth.idleTimeoutFor === 'function'
      ? auth.idleTimeoutFor(roles)
      : 0;

    let reason = null;
    if (user.sessionsValidAfter && Number(user.sessionsValidAfter) > session.loginAt) {
      reason = 'revoked';
    } else if (now - session.loginAt > cfg.absoluteTimeoutMs) {
      reason = 'absolute-timeout';
    } else if (idleMs > 0 && session.lastSeenAt && now - session.lastSeenAt > idleMs) {
      reason = 'idle-timeout';
    }

    if (reason) {
      const email = user.email || null;
      if (session.authToken && auth && typeof auth.logout === 'function') {
        Promise.resolve(auth.logout(session.authToken)).catch(() => {});
      }
      endCookieLogin(req);
      eventEmitter?.emit('auth:cookie-session-ended', { email, reason });
      return next();
    }

    session.lastSeenAt = now;
    return next();
  };
}

/**
 * Origin of a URL string, or null.
 * @param {string} value - URL
 * @return {?string}
 */
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch (_) {
    return null;
  }
}

/**
 * Creates the CSRF origin check.
 *
 * Applies only to state-changing requests that carry no `Authorization` or
 * `x-api-key` header, i.e. requests a browser could send on its own with the
 * session cookie. Requests with neither `Origin` nor `Referer` (non-browser
 * clients) pass.
 *
 * @param {Object=} opts - Options
 * @param {Array<string>=} opts.allowedOrigins - Extra trusted origins
 *     (for example the `CORS_ORIGINS` list)
 * @param {EventEmitter=} opts.eventEmitter - Receives rejection events
 * @return {function(express.Request, express.Response, Function): void}
 */
function createOriginCheck({ allowedOrigins = [], eventEmitter } = {}) {
  const trusted = new Set(allowedOrigins.map(originOf).filter(Boolean));
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.headers.authorization || req.headers['x-api-key']) return next();

    const claimed = req.headers.origin && req.headers.origin !== 'null'
      ? originOf(req.headers.origin)
      : (req.headers.referer ? originOf(req.headers.referer) : (req.headers.origin === 'null' ? 'null' : null));
    if (!claimed) return next();

    const hosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    let claimedHost = null;
    try { claimedHost = new URL(claimed).host; } catch (_) { /* opaque origin */ }
    if ((claimedHost && hosts.includes(claimedHost)) || trusted.has(claimed)) return next();

    eventEmitter?.emit('auth:csrf-origin-rejected', { origin: claimed, method: req.method, path: req.originalUrl });
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Cross-site request refused',
      code: 'CSRF_ORIGIN_MISMATCH'
    });
  };
}

/**
 * Sends `Referrer-Policy: no-referrer` so dashboard URLs never leak to the
 * CDNs the pages load.
 * @return {function(express.Request, express.Response, Function): void}
 */
function referrerPolicy() {
  return (req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  };
}

module.exports = { createCookieSessionHygiene, createOriginCheck, referrerPolicy, endCookieLogin };
