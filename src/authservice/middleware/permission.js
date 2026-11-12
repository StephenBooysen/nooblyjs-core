/**
 * @fileoverview Route-level permission enforcement (feature 19).
 *
 * Mounted once on `/services` by the ServiceRegistry, after the portal guard
 * and before any service registers its routes, so it runs in front of every
 * service API whatever that service's own guards do. For each request it
 * looks up the required permission (`policy/routePermissions.js`),
 * authenticates the caller, and checks the caller's grants:
 *
 * - **Session or Passport user:** the grants of their roles.
 * - **Personal access token (`dtk_`):** the owner's role grants, narrowed to
 *   the token's `scopes` when it has any.
 * - **Static API key:** its `scopes` (`apiKeys: [{ key, scopes }]`); a plain
 *   string key keeps full access, as before.
 *
 * Public routes pass without a credential. A route with no declared
 * permission is refused in strict mode and allowed (with an event) otherwise.
 *
 * @module authservice/middleware/permission
 */

'use strict';

const { permissionFor } = require('../policy/routePermissions');
const { hasPermission, grantsForRoles } = require('../modules/permissions');

/**
 * Works out whether the authenticated caller holds a permission.
 *
 * @param {express.Request} req - Request after authentication
 * @param {string} permission - Permission needed
 * @param {!Object<string, !Array<string>>} roleMap - Role grants
 * @return {boolean}
 */
function callerHas(req, permission, roleMap) {
  // Static key (not a personal token): its scopes, or full access if unscoped.
  if (req.apiKey && !req.tokenAuth) {
    const scopes = req.apiKeyScopes;
    return scopes ? hasPermission(scopes, permission) : true;
  }
  const roles = (req.user && Array.isArray(req.user.roles) && req.user.roles)
    || (req.user && req.user.role ? [req.user.role] : null)
    || (Array.isArray(req.userRoles) ? req.userRoles : []);
  if (!hasPermission(grantsForRoles(roles, roleMap), permission)) return false;
  if (req.tokenAuth && Array.isArray(req.tokenScopes) && req.tokenScopes.length > 0) {
    return hasPermission(req.tokenScopes, permission);
  }
  return true;
}

/**
 * Creates the permission middleware.
 *
 * @param {Object} opts - Options
 * @param {function(express.Request, express.Response, Function): void} opts.authenticate
 *     Authentication middleware that ignores `excludePaths` (responds 401 itself)
 * @param {!Object<string, !Array<string>>} opts.roleMap - Role grants
 * @param {boolean} opts.enabled - False when the registry runs without auth
 * @param {boolean} opts.strict - Refuse routes with no declared permission
 * @param {EventEmitter=} opts.eventEmitter - Receives permission events
 * @return {function(express.Request, express.Response, Function): void}
 */
function createPermissionMiddleware({ authenticate, roleMap, enabled, strict, eventEmitter }) {
  return (req, res, next) => {
    const servicesPath = ((req.baseUrl || '') + req.path).replace(/^\/services(?=\/|$)/, '');
    const permission = permissionFor(req.method, servicesPath);

    if (permission === null || permission === 'public' || !enabled) return next();

    if (permission === undefined) {
      eventEmitter?.emit('auth:permission-undeclared', { method: req.method, path: servicesPath });
      if (!strict) return next();
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This route has no declared permission',
        code: 'PERMISSION_UNDECLARED'
      });
    }

    return authenticate(req, res, () => {
      if (callerHas(req, permission, roleMap)) {
        req.permission = permission;
        return next();
      }
      eventEmitter?.emit('auth:permission-denied', {
        permission,
        method: req.method,
        path: servicesPath,
        user: (req.user && req.user.email) || null,
        apiKey: Boolean(req.apiKey && !req.tokenAuth)
      });
      return res.status(403).json({
        error: 'Forbidden',
        message: `This action needs the "${permission}" permission`,
        code: 'PERMISSION_DENIED',
        permission
      });
    });
  };
}

/**
 * Route-level guard for app code that mounts its own routes:
 * `app.post('/x', requirePermission('reports:run', roleMap), handler)`.
 * Expects authentication to have run already.
 *
 * @param {string} permission - Permission needed
 * @param {!Object<string, !Array<string>>} roleMap - Role grants
 * @return {function(express.Request, express.Response, Function): void}
 */
function requirePermission(permission, roleMap) {
  return (req, res, next) => {
    if (callerHas(req, permission, roleMap)) return next();
    return res.status(403).json({
      error: 'Forbidden',
      message: `This action needs the "${permission}" permission`,
      code: 'PERMISSION_DENIED',
      permission
    });
  };
}

module.exports = { createPermissionMiddleware, requirePermission, callerHas };
