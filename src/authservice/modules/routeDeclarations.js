/**
 * @fileoverview Declared route permissions: matching requests to declarations,
 * and finding routes that have none (feature 19).
 *
 * Each `/services/*\/api` route declares the permission it needs, in
 * ../config/routePermissions.js or with `requirePermission()` on the route. The
 * permission gate matches a request to the most specific declared pattern. In
 * strict mode a request no declaration matches is refused, and
 * `findUndeclaredRoutes(app)` lists routes without a declaration so that start-up
 * can fail.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const { compileRoute } = require('../../shared/utils/routePattern');
const { ROUTE_PERMISSIONS } = require('../config/routePermissions');

/** Matches the `/:instanceName` segment right after `/api` in a route pattern. */
const INSTANCE_SEGMENT = /^(\/services\/[^/]+\/api)\/:instanceName(?=\/)/;

/** True for a path or pattern under /services/{service}/api. */
const isApiPath = (path) => /^\/services\/[^/]+\/api(\/|$)/.test(path);

/**
 * The pattern a route is declared under: its `/:instanceName` variant shares the
 * default route's declaration.
 * @param {string} pattern Route pattern
 * @return {string} Declared pattern
 */
function declaredPattern(pattern) {
  return pattern.replace(INSTANCE_SEGMENT, '$1');
}

/**
 * Ranks patterns so that the most specific wins: more literal segments first,
 * then fewer wildcards, then fewer parameters.
 * @param {string} pattern Route pattern
 * @return {Array<number>} Sort key, compared element by element
 */
function specificity(pattern) {
  const segments = pattern.split('/').slice(1);
  const literal = segments.filter((s) => !s.startsWith(':') && s !== '*').length;
  const wildcards = segments.filter((s) => s === '*' || /\(\*\)$/.test(s)).length;
  const params = segments.filter((s) => s.startsWith(':')).length;
  return [-literal, wildcards, params];
}

/**
 * A table of declarations, compiled for matching.
 */
class RouteDeclarations {
  /**
   * @param {Object<string, string>=} initial `METHOD pattern` → permission
   */
  constructor(initial = ROUTE_PERMISSIONS) {
    /** @private {Map<string, string>} */
    this.table_ = new Map();
    /** @private {?Array<{method: string, regexp: RegExp, permission: string, key: Array<number>}>} */
    this.compiled_ = null;
    this.declare(initial);
  }

  /**
   * Adds declarations. A later declaration for the same route replaces the earlier one.
   * @param {Object<string, string>} map `METHOD pattern` → permission
   * @return {void}
   * @throws {Error} When a key is not `METHOD /services/{service}/api/...` or a permission is not a string
   */
  declare(map) {
    for (const [key, permission] of Object.entries(map || {})) {
      const match = /^(GET|POST|PUT|PATCH|DELETE|ALL) (\/\S*)$/.exec(key);
      if (!match || !isApiPath(match[2])) {
        throw new Error(`Route permission key must be "METHOD /services/{service}/api/...", got "${key}"`);
      }
      if (typeof permission !== 'string' || !permission) {
        throw new Error(`Route permission for "${key}" must be a permission string`);
      }
      this.table_.set(`${match[1]} ${declaredPattern(match[2])}`, permission);
    }
    this.compiled_ = null;
  }

  /**
   * The permission declared for a route pattern, or null.
   * @param {string} method HTTP method
   * @param {string} pattern Route pattern as registered
   * @return {?string} Permission
   */
  forRoute(method, pattern) {
    const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
    const p = declaredPattern(pattern);
    return this.table_.get(`${m} ${p}`) ?? this.table_.get(`ALL ${p}`) ?? null;
  }

  /**
   * The permission for a request: the most specific declared pattern that
   * matches it, including the `/:instanceName` variant of each declaration.
   * @param {string} method HTTP method
   * @param {string} path Request path, without the query string
   * @return {?string} Permission, or null when no declaration matches
   */
  forRequest(method, path) {
    const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
    for (const entry of this.compiled()) {
      if ((entry.method === m || entry.method === 'ALL') && entry.regexp.test(path)) {
        return entry.permission;
      }
    }
    return null;
  }

  /**
   * Compiles the table once per change.
   * @private
   * @return {Array<{method: string, regexp: RegExp, permission: string, key: Array<number>}>} Sorted matchers
   */
  compiled() {
    if (this.compiled_) return this.compiled_;
    const entries = [];
    for (const [key, permission] of this.table_) {
      const space = key.indexOf(' ');
      const method = key.slice(0, space);
      const pattern = key.slice(space + 1);
      const instanceVariant = pattern.replace(/^(\/services\/[^/]+\/api)(?=\/)/, '$1/:instanceName');
      entries.push({ method, regexp: compileRoute(pattern).regexp, permission, key: specificity(pattern) });
      if (instanceVariant !== pattern) {
        // The named-instance form ranks below every default route with the same literals.
        const key2 = specificity(instanceVariant);
        entries.push({ method, regexp: compileRoute(instanceVariant).regexp, permission, key: key2 });
      }
    }
    entries.sort((a, b) => {
      for (let i = 0; i < a.key.length; i += 1) {
        if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
      }
      return 0;
    });
    this.compiled_ = entries;
    return entries;
  }

  /** @return {number} Number of declared routes */
  get size() {
    return this.table_.size;
  }
}

/**
 * Lists the `/services/*\/api` routes registered on an Express app.
 *
 * Reads the router's layers. A route registered with `route()` from
 * src/shared/utils/routePattern.js carries its source pattern; another RegExp
 * route is listed with `pattern: null`. A route whose handlers include
 * `requirePermission()` reports that permission.
 *
 * @param {import('express').Application} app Express app
 * @return {Array<{method: string, pattern: ?string, regexp: ?string, permission: ?string}>} Routes
 */
function listApiRoutes(app) {
  const stack = app?._router?.stack || app?.router?.stack || [];
  const routes = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route) continue;
    const handlerPermission = (route.stack || []).map((l) => l.handle?.permission).find(Boolean) || null;
    const handlerSchema = (route.stack || []).map((l) => l.handle?.schema).find(Boolean) || null;
    const methods = Object.keys(route.methods || {}).filter((m) => route.methods[m] && m !== '_all');
    if (route.methods?._all) methods.push('all');
    for (const path of [].concat(route.path)) {
      let pattern = null;
      let regexp = null;
      if (typeof path === 'string') pattern = path;
      else if (path instanceof RegExp) {
        pattern = path.pattern || null;
        regexp = String(path);
      }
      const apiLike = pattern ? isApiPath(pattern) : /services\\\/[^\\]+\\\/api/.test(regexp || '');
      if (!apiLike) continue;
      for (const method of methods) {
        routes.push({ method: method.toUpperCase(), pattern, regexp, permission: handlerPermission, schema: handlerSchema });
      }
    }
  }
  return routes;
}

/**
 * Picks up `requirePermission()` declarations from an app's routes.
 * @param {import('express').Application} app Express app
 * @param {RouteDeclarations} declarations Table to add to
 * @return {void}
 */
function adoptHandlerDeclarations(app, declarations) {
  const found = {};
  for (const route of listApiRoutes(app)) {
    if (route.permission && route.pattern) found[`${route.method} ${route.pattern}`] = route.permission;
  }
  if (Object.keys(found).length) declarations.declare(found);
}

/**
 * Lists API routes on an app that have no declared permission.
 * @param {import('express').Application} app Express app
 * @param {RouteDeclarations} declarations Declarations to check against
 * @return {Array<string>} `METHOD pattern` for each undeclared route
 */
function findUndeclaredRoutes(app, declarations) {
  adoptHandlerDeclarations(app, declarations);
  const missing = [];
  for (const route of listApiRoutes(app)) {
    if (!route.pattern) {
      missing.push(`${route.method} ${route.regexp} (a RegExp route: register it with route() or requirePermission())`);
      continue;
    }
    if (route.permission) continue;
    if (!declarations.forRoute(route.method, route.pattern)) missing.push(`${route.method} ${route.pattern}`);
  }
  return [...new Set(missing)];
}

module.exports = {
  RouteDeclarations,
  listApiRoutes,
  adoptHandlerDeclarations,
  findUndeclaredRoutes,
  declaredPattern,
  isApiPath
};
