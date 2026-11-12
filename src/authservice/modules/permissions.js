/**
 * @fileoverview Permissions and role mapping (feature 19).
 *
 * A permission is `{area}:{action}`, for example `filing:read`, `jobs:run`,
 * `workflows:define` or `users:manage`. Grants may use wildcards: `*` (every
 * permission) or `{area}:*` (every action in an area). Roles map to grants in
 * one place, overridable with `security.roles`:
 *
 * ```javascript
 * serviceRegistry.initialize(app, emitter, {
 *   security: { roles: { auditor: ['log:read', 'metrics:read'] } }
 * });
 * ```
 *
 * The defaults match what each role could reach before feature 19: admins
 * everything; users their own profile and reading documents; editors also
 * writing documents.
 *
 * @module authservice/modules/permissions
 */

'use strict';

/**
 * Built-in role grants. Custom roles from `security.roles` are merged over
 * these (a custom entry for a built-in role replaces it).
 * @const {!Object<string, !Array<string>>}
 */
const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  admin: ['*'],
  editor: ['filing:read', 'filing:write', 'knowledge:read', 'profile:manage'],
  user: ['filing:read', 'knowledge:read', 'profile:manage'],
  guest: []
});

/**
 * Whether a set of grants includes a permission.
 *
 * @param {?Array<string>} granted - Grants, possibly with wildcards
 * @param {string} needed - The permission required, e.g. 'filing:write'
 * @return {boolean}
 *
 * @example
 * hasPermission(['filing:*'], 'filing:write'); // true
 * hasPermission(['filing:read'], 'filing:write'); // false
 */
function hasPermission(granted, needed) {
  if (!Array.isArray(granted) || !needed) return false;
  const area = needed.split(':')[0];
  return granted.some((g) => g === '*' || g === needed || g === `${area}:*`);
}

/**
 * Builds the effective role map.
 *
 * @param {Object<string, Array<string>>=} custom - Role overrides
 * @return {!Object<string, !Array<string>>}
 */
function buildRoleMap(custom) {
  const map = { ...DEFAULT_ROLE_PERMISSIONS };
  if (custom && typeof custom === 'object') {
    for (const [role, grants] of Object.entries(custom)) {
      if (Array.isArray(grants)) map[role] = grants.map(String);
    }
  }
  return map;
}

/**
 * The grants for a list of roles.
 *
 * @param {Array<string>} roles - Role names
 * @param {!Object<string, !Array<string>>} roleMap - From buildRoleMap()
 * @return {!Array<string>} Union of the roles' grants
 */
function grantsForRoles(roles, roleMap) {
  const grants = new Set();
  for (const role of Array.isArray(roles) ? roles : []) {
    for (const g of roleMap[role] || []) grants.add(g);
  }
  return Array.from(grants);
}

/**
 * Normalises the `apiKeys` option, which may mix plain strings and scoped
 * entries (`{ key, name, scopes }`).
 *
 * @param {Array<(string|{key: string, name: string=, scopes: Array<string>=})>} entries
 * @return {{keys: !Array<string>, scopes: !Map<string, ?Array<string>>,
 *     names: !Map<string, ?string>}} Keys for matching, and each key's scopes
 *     (null for a plain string key, which keeps full access) and name
 */
function normalizeApiKeys(entries) {
  const keys = [];
  const scopes = new Map();
  const names = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry === 'string' && entry) {
      keys.push(entry);
      scopes.set(entry, null);
      names.set(entry, null);
    } else if (entry && typeof entry === 'object' && typeof entry.key === 'string' && entry.key) {
      keys.push(entry.key);
      scopes.set(entry.key, Array.isArray(entry.scopes) ? entry.scopes.map(String) : null);
      names.set(entry.key, entry.name ? String(entry.name) : null);
    }
  }
  return { keys, scopes, names };
}

module.exports = {
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  buildRoleMap,
  grantsForRoles,
  normalizeApiKeys
};
