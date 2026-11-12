/**
 * @fileoverview Route-level authorization for the filing API (feature 15).
 *
 * The filing API is exempt from the /services portal admin guard so regular
 * users (wiki, Teams, browser extension) can read documents. That exemption
 * must not hand every signed-in user the whole API, so this middleware sorts
 * each request into a tier and checks the caller's roles:
 *
 * | Tier  | Routes                                                     | Default roles      |
 * |-------|------------------------------------------------------------|--------------------|
 * | read  | download, browse, file-tree, status, pdf-preview, swagger  | any signed-in user |
 * | write | upload, upload-stream, remove                              | admin, editor      |
 * | admin | settings, git/*, sync/*, instances, analytics              | admin              |
 *
 * An optional `acl` maps path prefixes to the roles allowed to read or write
 * under them, for example `{ 'private/': ['admin'] }`.
 *
 * Static API keys are operator-configured machine credentials and pass every
 * tier; scoped keys arrive with feature 19. When authentication is switched
 * off for the registry (no auth middleware, or `requireApiKey: false`), there
 * is no identity to check and the middleware lets requests through.
 *
 * @module filing/modules/access
 */

'use strict';

/** First path segments that name a filing route rather than an instance. */
const ROUTE_WORDS = new Set([
  'upload', 'upload-stream', 'download', 'remove', 'status', 'instances',
  'browse', 'settings', 'sync', 'git', 'analytics', 'file-tree',
  'pdf-preview', 'swagger'
]);

const WRITE_ROUTES = new Set(['upload', 'upload-stream', 'remove']);
const ADMIN_ROUTES = new Set(['settings', 'sync', 'git', 'instances', 'analytics']);
/** Routes whose remaining path is a file key, used for ACL checks. */
const KEYED_ROUTES = new Set(['upload', 'upload-stream', 'download', 'remove', 'browse', 'pdf-preview']);

const DEFAULT_WRITE_ROLES = ['admin', 'editor'];
const DEFAULT_ADMIN_ROLES = ['admin'];

/**
 * Classifies a filing API request.
 *
 * @param {string} method - HTTP method
 * @param {string} relPath - Path below /services/filing/api (e.g. '/default/settings')
 * @return {{tier: string, route: ?string, key: ?string}} The tier ('read',
 *     'write' or 'admin'), the route word, and the file key when the route has one
 */
function classifyRequest(method, relPath) {
  let segments = String(relPath || '').split('/').filter(Boolean);
  if (segments.length && !ROUTE_WORDS.has(segments[0])) {
    // A leading segment that is not a route word is an instance name.
    segments = segments.slice(1);
  }
  const route = segments[0] || null;
  let key = null;
  if (route && KEYED_ROUTES.has(route)) {
    try {
      key = segments.slice(1).map(decodeURIComponent).join('/');
    } catch (err) {
      key = segments.slice(1).join('/');
    }
  }

  let tier = 'read';
  if (ADMIN_ROUTES.has(route)) {
    tier = 'admin';
  } else if (WRITE_ROUTES.has(route) || !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    // Any unrecognised state-changing request is treated as a write at least.
    tier = 'write';
  }
  return { tier, route, key };
}

/**
 * Reads the caller's roles from whichever credential authenticated them.
 *
 * @param {express.Request} req - Express request
 * @return {!Array<string>} Roles (possibly empty)
 */
function rolesOf(req) {
  const fromUser = req.user && (Array.isArray(req.user.roles)
    ? req.user.roles
    : (req.user.role ? [req.user.role] : null));
  if (fromUser) return fromUser;
  if (Array.isArray(req.userRoles)) return req.userRoles;
  return [];
}

/**
 * Whether `roles` satisfies `allowed` ('*' in allowed means any signed-in user).
 *
 * @param {!Array<string>} roles - Caller's roles
 * @param {!Array<string>} allowed - Roles allowed
 * @return {boolean}
 */
function hasAnyRole(roles, allowed) {
  return allowed.includes('*') || roles.some((role) => allowed.includes(role));
}

/**
 * Finds the most specific ACL rule for a key.
 *
 * @param {?Object<string, !Array<string>>} acl - Prefix → roles
 * @param {?string} key - File key
 * @return {?Array<string>} The roles for the longest matching prefix, or null
 */
function aclRolesFor(acl, key) {
  if (!acl || key === null || key === undefined) return null;
  const normalized = String(key).replace(/\\/g, '/').replace(/^\/+/, '');
  let best = null;
  for (const prefix of Object.keys(acl)) {
    const p = prefix.replace(/^\/+/, '');
    if (normalized.startsWith(p) && (best === null || p.length > best.length)) {
      best = p;
    }
  }
  if (best === null) return null;
  const roles = acl[Object.keys(acl).find((k) => k.replace(/^\/+/, '') === best)];
  return Array.isArray(roles) ? roles : [roles];
}

/**
 * Creates the filing authorization middleware.
 *
 * @param {Object} options - Filing route options
 * @param {Function=} options.authMiddleware - The registry's API auth middleware
 * @param {boolean=} options.requireApiKey - False when the registry disabled auth
 * @param {Object=} options.access - Access configuration
 * @param {Array<string>=} options.access.writeRoles - Roles for the write tier
 * @param {Array<string>=} options.access.adminRoles - Roles for the admin tier
 * @param {Object<string, Array<string>>=} options.access.acl - Path-prefix rules
 * @param {EventEmitter=} eventEmitter - Receives `filing:access-denied`
 * @return {function(express.Request, express.Response, Function): void} Middleware
 *
 * @example
 * app.use('/services/filing/api', requireApiAuth, createFilingAccessGuard(options, eventEmitter));
 */
function createFilingAccessGuard(options = {}, eventEmitter = null) {
  const access = options.access || options.filingAccess || {};
  const writeRoles = access.writeRoles || DEFAULT_WRITE_ROLES;
  const adminRoles = access.adminRoles || DEFAULT_ADMIN_ROLES;
  const acl = access.acl || null;
  const enforce = typeof options.authMiddleware === 'function' && options.requireApiKey !== false;

  return (req, res, next) => {
    if (!enforce) return next();

    const { tier, route, key } = classifyRequest(req.method, req.path);

    // Operator-configured static API keys pass every tier (feature 19 scopes them).
    if (req.apiKey && !req.tokenAuth) return next();

    const roles = rolesOf(req);
    const deny = (reason) => {
      if (eventEmitter) {
        eventEmitter.emit('filing:access-denied', {
          tier, route, key, reason, method: req.method,
          user: req.user && req.user.email
        });
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: reason,
        code: 'FILING_FORBIDDEN'
      });
    };

    if (tier === 'admin' && !hasAnyRole(roles, adminRoles)) {
      return deny('Administrator role is required for this filing operation');
    }
    if (tier === 'write' && !hasAnyRole(roles, writeRoles) && !hasAnyRole(roles, adminRoles)) {
      return deny('You do not have permission to change files');
    }
    const aclRoles = aclRolesFor(acl, key);
    if (aclRoles && !hasAnyRole(roles, aclRoles) && !hasAnyRole(roles, adminRoles)) {
      return deny('You do not have access to this path');
    }
    return next();
  };
}

module.exports = { createFilingAccessGuard, classifyRequest, aclRolesFor };
