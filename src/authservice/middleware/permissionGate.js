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

/** Needs the wildcard grant, which only the admin role (or an unscoped key) holds. */
const UNDECLARED = '*';

/**
 * Creates the gate.
 *
 * @param {Object} options
 * @param {function(import('express').Request): Promise<?{roles?: string[], scopes?: ?string[], principal: string}>} options.resolvePrincipal
 *   Returns who is calling: roles for a session or token owner, or scopes for an API key (null scopes = full access)
 * @param {Object=} options.eventEmitter Receives auth:permission-denied
 * @param {Object=} options.declarations RouteDeclarations: the permission each route declares (checked first)
 * @param {function(): boolean=} options.strict Returns true in strictAuth mode, where a route with no declaration is refused
 * @param {function(import('express').Request, string): boolean=} options.anonymousDenied Returns true when an anonymous caller must be refused on this path (API keys required and the path not excluded)
 * @return {function(import('express').Request, import('express').Response, import('express').NextFunction): Promise<void>} Middleware
 */
function createPermissionGate({
  resolvePrincipal,
  eventEmitter = null,
  declarations = null,
  strict = () => false,
  anonymousDenied = () => false
}) {
  return async function permissionGate(req, res, next) {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    let needed = declarations ? declarations.forRequest(req.method, path) : null;
    if (!needed) {
      if (strict()) {
        // Strict: a route nobody declared is open only to the wildcard grant.
        needed = permissionForRequest(req.method, path) ? UNDECLARED : null;
      } else {
        needed = permissionForRequest(req.method, path);
      }
    }
    if (!needed || needed === PUBLIC) return next();

    let principal;
    try {
      principal = await resolvePrincipal(req);
    } catch (_err) {
      principal = null;
    }
    // No caller identity. When API keys are required, a declared non-public route
    // is never open to an anonymous caller, even if a service forgot its own
    // key check (feature 19). Otherwise the portal guard or the service decides.
    if (!principal) {
      if (anonymousDenied(req, path)) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'API key is required. Provide it via the x-api-key header or an Authorization header.',
          code: 'MISSING_API_KEY'
        });
      }
      return next();
    }

    // Later middleware (the filing tiers) reads the roles of the caller from here.
    req.principal = principal;

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

    // A personal access token may be narrowed to fewer permissions than its owner holds.
    const withinToken = !Array.isArray(principal.tokenScopes) || hasPermission(principal.tokenScopes, needed);
    if (hasPermission(granted, needed) && withinToken) return next();

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
