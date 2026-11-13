'use strict';

/**
 * @fileoverview Route-tier authorization for the filing API (feature 15).
 *
 * The filing API is deliberately kept out of the /services portal admin guard,
 * because wiki, Teams and browser-extension users read and write documents
 * through it. That exemption used to mean every signed-in user could reach every
 * filing route. This middleware restores the tiers, enforced per request:
 *
 * - **read**: download, browse, file-tree, status, pdf-preview. Any caller that
 *   passed the API-key/session middleware.
 * - **write**: upload, upload-stream, remove. A user with a write role
 *   (`writeRoles`, default `editor` and `admin`), an admin, or a data-plane API
 *   key (machine integrations).
 * - **admin**: everything else, including settings, git, sync, instances and
 *   analytics. Requires the `admin` role or an admin-scoped API key. A
 *   data-plane key never reaches this tier, even when no admin keys exist.
 *
 * Unknown routes fall into the admin tier, so a new route fails closed until it
 * is classified here.
 *
 * @module filing/modules/filingAccess
 */

const { matchesAnyKey } = require('../../authservice/middleware/apiKey');

/** Roles that may write files when a user has no admin role. */
const DEFAULT_WRITE_ROLES = Object.freeze(['editor', 'admin']);

/** Read-only routes, matched against the path below /services/filing/api. */
const READ_ROUTES = [
  { method: 'GET', pattern: /^\/(?:[^/]+\/)?download\// },
  { method: 'GET', pattern: /^\/(?:[^/]+\/)?browse\// },
  { method: 'GET', pattern: /^\/file-tree$/ },
  { method: 'GET', pattern: /^\/status$/ },
  { method: 'GET', pattern: /^\/pdf-preview\// },
  { method: 'GET', pattern: /^\/swagger(\/|$)/ }
];

/** Write routes: create or replace file content, or delete it. */
const WRITE_ROUTES = [
  { method: 'POST', pattern: /^\/(?:[^/]+\/)?upload(?:-stream)?\// },
  { method: 'DELETE', pattern: /^\/(?:[^/]+\/)?remove\// }
];

/**
 * Classifies a request into the tier it needs.
 *
 * @param {string} method - HTTP method
 * @param {string} subPath - Path below /services/filing/api (req.path in a mounted router)
 * @return {'read'|'write'|'admin'} The tier the route requires
 *
 * @example
 * requiredTier('GET', '/download/a.pdf');   // 'read'
 * requiredTier('POST', '/settings');        // 'admin'
 */
function requiredTier(method, subPath) {
  const verb = String(method || '').toUpperCase();
  const isRead = verb === 'GET' || verb === 'HEAD';
  if (isRead && READ_ROUTES.some((r) => r.pattern.test(subPath))) return 'read';
  if (WRITE_ROUTES.some((r) => r.method === verb && r.pattern.test(subPath))) return 'write';
  return 'admin';
}

/**
 * Lists the admin-scoped API keys. Unlike the portal guard, this never falls
 * back to the general data-plane keys.
 *
 * @param {Object} serviceRegistry - Registry exposing globalOptions / securityConfig
 * @return {string[]} Admin API keys (possibly empty)
 */
function getAdminApiKeys(serviceRegistry) {
  if (!serviceRegistry) return [];
  const fromGlobal = serviceRegistry.globalOptions && serviceRegistry.globalOptions.adminApiKeys;
  if (Array.isArray(fromGlobal)) return fromGlobal;
  const fromSecurity = serviceRegistry.securityConfig
    && serviceRegistry.securityConfig.servicesAuth
    && serviceRegistry.securityConfig.servicesAuth.apiKeys;
  return Array.isArray(fromSecurity) ? fromSecurity : [];
}

/**
 * Returns the roles of the authenticated caller, if any.
 *
 * @param {Object} req - Express request
 * @return {string[]} Roles from the session, API token or user record
 */
function callerRoles(req) {
  if (req.user && Array.isArray(req.user.roles)) return req.user.roles;
  if (req.user && req.user.role) return [req.user.role];
  if (Array.isArray(req.userRoles)) return req.userRoles;
  return [];
}

/**
 * Creates the Express middleware that enforces the filing route tiers.
 *
 * @param {Object} options - Options
 * @param {Object} [options.serviceRegistry] - Registry, used to read admin keys
 * @param {string[]} [options.writeRoles] - Roles allowed to write
 * @param {EventEmitter} [options.eventEmitter] - Receives `filing:access-denied`
 * @return {function(express.Request, express.Response, Function): void} Middleware
 *
 * @example
 * app.use('/services/filing/api', createFilingAccessMiddleware({ serviceRegistry }));
 */
function createFilingAccessMiddleware({
  serviceRegistry,
  writeRoles = DEFAULT_WRITE_ROLES,
  eventEmitter
} = {}) {
  const allowedWriters = [...writeRoles];

  return (req, res, next) => {
    const tier = requiredTier(req.method, req.path);
    if (tier === 'read') return next();

    const roles = callerRoles(req);
    const isAdminKey = Boolean(req.apiKey)
      && matchesAnyKey(req.apiKey, getAdminApiKeys(serviceRegistry));
    const isAdmin = roles.includes('admin') || isAdminKey;

    if (isAdmin) return next();
    if (tier === 'write' && (req.apiKey || roles.some((r) => allowedWriters.includes(r)))) {
      return next();
    }

    eventEmitter?.emit('filing:access-denied', {
      method: req.method,
      path: req.path,
      tier,
      email: req.user?.email
    });
    return res.status(403).json({
      success: false,
      error: 'Insufficient privileges',
      message: tier === 'admin'
        ? 'Administrator role is required for this filing operation'
        : 'A write role is required to change files'
    });
  };
}

module.exports = {
  createFilingAccessMiddleware,
  requiredTier,
  DEFAULT_WRITE_ROLES
};
