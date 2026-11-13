/**
 * @fileoverview Route-level permission gate for /services/*\/api (feature 19).
 *
 * The portal guard decides who may open the dashboard. This gate decides what
 * an authenticated caller may do on an API route, whatever the portal guard
 * allowed. It runs for session users, scoped API keys and personal access tokens.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const { permissionForRequest, permissionsForRoles, hasPermission, PUBLIC } = require('../modules/permissions');

/**
 * Creates the gate.
 *
 * @param {Object} options
 * @param {function(import('express').Request): Promise<?{roles?: string[], scopes?: ?string[], principal: string}>} options.resolvePrincipal
 *   Returns who is calling: roles for a session or token owner, or scopes for an API key (null scopes = full access)
 * @param {Object=} options.eventEmitter Receives auth:permission-denied
 * @return {function(import('express').Request, import('express').Response, import('express').NextFunction): Promise<void>} Middleware
 */
function createPermissionGate({ resolvePrincipal, eventEmitter = null }) {
  return async function permissionGate(req, res, next) {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const needed = permissionForRequest(req.method, path);
    if (!needed || needed === PUBLIC) return next();

    let principal;
    try {
      principal = await resolvePrincipal(req);
    } catch (_err) {
      principal = null;
    }
    // No caller identity here: the portal guard or the service decides (e.g. a public route).
    if (!principal) return next();

    // A session or token grants what its roles grant; an API key grants its scopes,
    // and a plain (unscoped) key grants everything, as it did before scopes existed.
    let granted;
    if (Array.isArray(principal.roles)) {
      granted = permissionsForRoles(principal.roles);
    } else if (principal.scopes === null) {
      granted = ['*'];
    } else {
      granted = Array.isArray(principal.scopes) ? principal.scopes : [];
    }

    if (hasPermission(granted, needed)) return next();

    eventEmitter?.emit?.('auth:permission-denied', {
      principal: principal.principal,
      permission: needed,
      method: req.method,
      path
    });
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      code: 'PERMISSION_DENIED',
      permission: needed
    });
  };
}

module.exports = { createPermissionGate };
