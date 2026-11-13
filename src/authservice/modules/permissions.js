/**
 * @fileoverview Permissions for routes and credentials (feature 19).
 *
 * A permission is `service:action`, for example `filing:write` or `users:manage`.
 * Grants may use `*` (everything) or `service:*` (every action of one service).
 * Sessions get the permissions of their roles; API keys get their declared
 * scopes. A plain string key is a full-access key, as before.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const crypto = require('node:crypto');

/** Permission every principal holds, for login, registration and other public routes. */
const PUBLIC = 'public';

/** Role grants. Edit here to change what a role may do. */
const ROLE_PERMISSIONS = Object.freeze({
  admin: ['*'],
  editor: [
    'filing:*', 'searching:*', 'dataservice:*', 'caching:*', 'queueing:*',
    'logging:read', 'measuring:read', 'knowledge:*', 'profile:*'
  ],
  user: ['filing:read', 'searching:read', 'profile:*']
});

/**
 * Route rules checked before the default. The first match wins. `method`
 * omitted means any method. Paths are matched against the full request path.
 */
const ROUTE_RULES = Object.freeze([
  // Public authentication routes: anyone may call them.
  { match: /^\/services\/authservice\/api\/(login|logout|register|validate|redeem|session\/exchange)(\/|$)/, permission: PUBLIC },
  { method: 'POST', match: /^\/services\/authservice\/api\/invitations$/, permission: PUBLIC },
  { method: 'GET', match: /^\/services\/authservice\/api\/invitations\/[^/]+$/, permission: PUBLIC },
  { method: 'POST', match: /^\/services\/authservice\/api\/invitations\/[^/]+\/redeem$/, permission: PUBLIC },
  // Own profile and personal access tokens.
  { match: /^\/services\/authservice\/api\/profile(\/|$)/, permission: 'profile:manage' },
  // Administration.
  { match: /^\/services\/authservice\/api\/(users|roles)(\/|$)/, permission: 'users:manage' },
  { match: /^\/services\/authservice\/api\/invitations(\/|$)/, permission: 'invitations:approve' },
  { match: /^\/services\/settings\/api(\/|$)/, permission: 'settings:manage' },
  { match: /^\/services\/working\/api\/run(\/|$)/, permission: 'jobs:run' },
  { match: /^\/services\/scheduling\/api(\/|$)/, method: 'POST', permission: 'jobs:run' },
  { match: /^\/services\/scheduling\/api(\/|$)/, method: 'PUT', permission: 'jobs:run' },
  { match: /^\/services\/scheduling\/api(\/|$)/, method: 'DELETE', permission: 'jobs:run' },
  { match: /^\/services\/workflow\/api(\/|$)/, method: 'POST', permission: 'workflows:define' },
  { match: /^\/services\/workflow\/api(\/|$)/, method: 'PUT', permission: 'workflows:define' },
  { match: /^\/services\/workflow\/api(\/|$)/, method: 'DELETE', permission: 'workflows:define' }
]);

/**
 * Turns a key list entry into `{ key, name, scopes }`. A string is a full-access key
 * (scopes null); an object carries its own scopes.
 *
 * @param {Array<string|{key: string, name?: string, scopes?: string[]}>} list Keys from configuration
 * @return {Array<{key: string, name: string, scopes: ?Array<string>}>} Normalised entries
 */
function normalizeKeyEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      if (typeof entry === 'string') return { key: entry, name: 'unnamed', scopes: null };
      if (entry && typeof entry.key === 'string') {
        const scopes = Array.isArray(entry.scopes) ? entry.scopes.map(String) : [];
        return { key: entry.key, name: String(entry.name || 'unnamed'), scopes };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Finds the entry whose key equals the provided key. Compares SHA-256 digests in
 * constant time, so neither the key nor its length leaks through timing.
 *
 * @param {string} provided Key from the request
 * @param {Array<{key: string}>} entries Normalised entries
 * @return {?{key: string, name: string, scopes: ?Array<string>}} The matching entry, or null
 */
function findKeyEntry(provided, entries) {
  if (typeof provided !== 'string' || provided.length === 0) return null;
  const digest = crypto.createHash('sha256').update(provided).digest();
  let found = null;
  for (const entry of entries) {
    const other = crypto.createHash('sha256').update(entry.key).digest();
    if (crypto.timingSafeEqual(digest, other) && found === null) {
      found = entry;
    }
  }
  return found;
}

/**
 * Permissions a set of roles grants.
 * @param {Array<string>} roles Role names
 * @return {Array<string>} Granted permissions
 */
function permissionsForRoles(roles) {
  const list = Array.isArray(roles) ? roles : [];
  return list.flatMap((role) => ROLE_PERMISSIONS[role] || []);
}

/** A permission, a service wildcard or the full wildcard. */
const PERMISSION_SHAPE = /^(\*|[a-z]+:(\*|[a-z]+))$/;

/**
 * Checks the scopes asked for on a personal access token (feature 19). Each scope
 * must be a permission the owner holds, so a token can only narrow its owner.
 *
 * @param {*} scopes Scopes from the request
 * @param {Array<string>} ownerRoles Roles of the token's owner
 * @return {Array<string>} Normalised scopes
 * @throws {Error} When the list is empty, malformed, or wider than the owner's grants
 */
function validateTokenScopes(scopes, ownerRoles) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error('Token scopes must be a non-empty list of permissions');
  }
  const owner = permissionsForRoles(ownerRoles);
  const unique = [...new Set(scopes)];
  for (const scope of unique) {
    if (typeof scope !== 'string' || !PERMISSION_SHAPE.test(scope)) {
      throw new Error(`Invalid token scope "${String(scope)}"`);
    }
    if (!hasPermission(owner, scope)) {
      throw new Error(`Token scope "${scope}" is wider than the owner's permissions`);
    }
  }
  return unique;
}

/**
 * True when the granted list covers the needed permission.
 *
 * @param {Array<string>} granted Permissions held
 * @param {string} needed Permission required
 * @return {boolean} Whether access is allowed
 */
function hasPermission(granted, needed) {
  if (needed === PUBLIC) return true;
  if (!Array.isArray(granted)) return false;
  const service = needed.split(':')[0];
  return granted.some((g) => g === '*' || g === needed || g === `${service}:*`);
}

/**
 * Works out the permission a request needs.
 *
 * @param {string} method HTTP method
 * @param {string} path Request path under /services
 * @return {?string} Permission, or null when the path is not an API route
 */
function permissionForRequest(method, path) {
  if (!/^\/services\/[^/]+\/api(\/|$)/.test(path)) return null;
  for (const rule of ROUTE_RULES) {
    if (rule.method && rule.method !== method) continue;
    if (rule.match.test(path)) return rule.permission;
  }
  const service = path.split('/')[2];
  const action = method === 'GET' || method === 'HEAD' ? 'read' : 'write';
  return `${service}:${action}`;
}

module.exports = {
  PUBLIC,
  ROLE_PERMISSIONS,
  ROUTE_RULES,
  normalizeKeyEntries,
  findKeyEntry,
  permissionsForRoles,
  hasPermission,
  permissionForRequest,
  validateTokenScopes
};
