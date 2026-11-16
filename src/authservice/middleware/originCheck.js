/**
 * @fileoverview CSRF origin check for `/services` (feature 23).
 *
 * Refuses state-changing requests that ride on the session cookie when their
 * `Origin` (or `Referer`) names another site. This is defence in depth behind
 * `SameSite=strict` cookies. Helmet already sends `Referrer-Policy: no-referrer`,
 * so dashboards do not need a separate header here.
 *
 * @module authservice/middleware/originCheck
 */

'use strict';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Origin of a URL string, or null when it is not a URL.
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
 * @example
 * app.use('/services', createOriginCheck({ allowedOrigins: ['https://admin.example.com'] }));
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

module.exports = { createOriginCheck, originOf };
