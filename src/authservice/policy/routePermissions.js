/**
 * @fileoverview The permission every `/services/*\/api` route requires
 * (feature 19).
 *
 * One table, read top to bottom, first match wins. Each service has an
 * explicit block; within it, specific rules come before the service's
 * read / write defaults. A route under a service that has no block here is
 * *undeclared*: `listUndeclaredRoutes()` reports it, and
 * `ServiceRegistry.verifyRoutePermissions()` fails start-up on it in strict
 * mode (the default in production). Adding a service therefore means adding
 * its block here.
 *
 * `'public'` routes need no credential (login, health, invitation redeem).
 *
 * @module authservice/policy/routePermissions
 */

'use strict';

const { routePathOf } = require('../../shared/utils/routePattern');

/**
 * Permission area for each service path segment.
 * @const {!Object<string, string>}
 */
const SERVICE_AREAS = Object.freeze({
  ai: 'ai',
  authservice: 'auth',
  caching: 'cache',
  dataservice: 'data',
  fetching: 'fetch',
  filing: 'filing',
  logging: 'log',
  measuring: 'metrics',
  notifying: 'notify',
  queueing: 'queue',
  scheduling: 'jobs',
  searching: 'search',
  settings: 'settings',
  workflow: 'workflows',
  working: 'jobs',
  appservice: 'app',
  knowledge: 'knowledge'
});

const READ = ['GET', 'HEAD', 'OPTIONS'];
const ANY = null;

/**
 * Builds a rule.
 * @param {?Array<string>} methods - HTTP methods, or null for any
 * @param {!RegExp} pattern - Matched against the path below /services
 * @param {string} permission - Permission, or 'public'
 * @return {{methods: ?Array<string>, pattern: !RegExp, permission: string}}
 */
function rule(methods, pattern, permission) {
  return { methods, pattern, permission };
}

/** Optional `/:instanceName` segment used by multi-instance services. */
const INST = '(?:/[^/]+)?';

/**
 * Rules shared by every service: health is public, settings and analytics
 * resets are admin-only, API docs are readable.
 * @param {string} svc - Service path segment
 * @param {string} area - Permission area
 * @return {!Array<Object>}
 */
function commonRules(svc, area) {
  const base = `^/${svc}/api${INST}`;
  return [
    // Only the service's own status route is public, never a key or file
    // that happens to be called "status" (e.g. /filing/api/download/status).
    rule(READ, new RegExp(`^/${svc}/api/status/?$`), 'public'),
    rule(ANY, new RegExp(`${base}/settings/?$`), `${area}:admin`),
    rule(['DELETE'], new RegExp(`${base}/analytics(/.*)?$`), `${area}:admin`),
    rule(READ, new RegExp(`^/${svc}/api/swagger(/.*)?$`), `${area}:read`)
  ];
}

/**
 * Read / write defaults for a service, matched after its specific rules.
 * @param {string} svc - Service path segment
 * @param {string} area - Permission area
 * @return {!Array<Object>}
 */
function defaultRules(svc, area) {
  return [
    rule(READ, new RegExp(`^/${svc}/api(/.*)?$`), `${area}:read`),
    rule(ANY, new RegExp(`^/${svc}/api(/.*)?$`), `${area}:write`)
  ];
}

/** Specific rules per service, before the common and default rules. */
const SPECIFIC = {
  knowledge: [
    // Asking questions and retrieving passages only reads; evaluation calls the model for every case.
    rule(['POST'], /^\/knowledge\/api\/(ask|ask\/stream|retrieve)\/?$/, 'knowledge:read'),
    rule(['GET'], /^\/knowledge\/api\/(status|sources)\/?$/, 'knowledge:read'),
  ],
  authservice: [
    // Signing in and out, and what the login page needs.
    rule(['POST'], /^\/authservice\/api\/(login|logout|validate|register)\/?$/, 'public'),
    rule(['GET', 'POST'], /^\/authservice\/api\/logout\/?$/, 'public'),
    // Feature 23: one-time hand-off of a session token for the cookie.
    rule(['POST'], /^\/authservice\/api\/session\/handoff\/?$/, 'public'),
    rule(READ, /^\/authservice\/api\/session\/?$/, 'public'),
    rule(READ, /^\/authservice\/api\/(branding|sso-config)\/?$/, 'public'),
    rule(ANY, /^\/authservice\/api\/auth\/.*/, 'public'),
    rule(ANY, /^\/authservice\/api\/azure(\/.*)?$/, 'public'),
    rule(ANY, /^\/authservice\/openid(\/.*)?$/, 'public'),
    // Invitations: the public request (the route itself tells an admin
    // apart), the redeem page's lookup, and redeem. Everything else is admin.
    rule(['POST'], /^\/authservice\/api\/invitations\/?$/, 'public'),
    rule(['POST'], /^\/authservice\/api\/invitations\/batch\/?$/, 'invitations:manage'),
    rule(READ, /^\/authservice\/api\/invitations\/[^/]+\/?$/, 'public'),
    rule(['POST'], /^\/authservice\/api\/invitations\/[^/]+\/redeem\/?$/, 'public'),
    rule(ANY, /^\/authservice\/api\/invitations(\/.*)?$/, 'invitations:manage'),
    // Your own password and tokens.
    rule(ANY, /^\/authservice\/api\/profile(\/.*)?$/, 'profile:manage'),
    rule(ANY, /^\/authservice\/api\/users(\/.*)?$/, 'users:manage'),
    rule(ANY, /^\/authservice\/api\/roles(\/.*)?$/, 'roles:manage'),
    rule(ANY, /^\/authservice\/api\/analytics(\/.*)?$/, 'auth:admin')
  ],
  filing: [
    rule(ANY, /^\/filing\/api(?:\/[^/]+)?\/(git|sync)(\/.*)?$/, 'filing:admin'),
    rule(ANY, /^\/filing\/api(?:\/[^/]+)?\/(instances|analytics)(\/.*)?$/, 'filing:admin'),
    rule(ANY, /^\/filing\/api(?:\/[^/]+)?\/(upload|upload-stream|remove)(\/.*)?$/, 'filing:write')
  ],
  working: [
    rule(['POST'], /^\/working\/api\/run\/?$/, 'jobs:run'),
    // GET /stop changes state: treat it, and every other lifecycle call, as admin.
    rule(ANY, /^\/working\/api\/(stop|start|restart|shutdown|clear)(\/.*)?$/, 'jobs:admin')
  ],
  scheduling: [
    rule(READ, /^\/scheduling\/api(\/.*)?$/, 'jobs:read'),
    rule(ANY, /^\/scheduling\/api(\/.*)?$/, 'jobs:schedule')
  ],
  workflow: [
    rule(['POST'], /^\/workflow\/api\/(start|workflows\/[^/]+\/execute|schedules\/[^/]+\/run-now)\/?$/, 'workflows:run'),
    rule(['POST', 'DELETE'], /^\/workflow\/api\/runs(\/.*)?$/, 'workflows:run'),
    rule(['POST'], /^\/workflow\/api\/workflows\/[^/]+\/(star|view)\/?$/, 'workflows:read'),
    rule(ANY, /^\/workflow\/api\/state\/?$/, 'workflows:admin')
  ],
  ai: [
    // Feature 22 matrix: only an instance's status is public (the API-key
    // layer exempts '/services/*/status'); its health check needs ai:read.
    rule(READ, /^\/ai\/api\/[^/]+\/status\/?$/, 'public'),
    rule(['POST'], /^\/ai\/api(?:\/[^/]+)?\/(prompt|complete|stream|object|embed)\/?$/, 'ai:prompt'),
    rule(['POST', 'PUT', 'DELETE'], /^\/ai\/api(?:\/[^/]+)?\/train(\/.*)?$/, 'ai:admin')
  ],
  settings: [
    rule(['POST'], /^\/settings\/api\/reload\/?$/, 'settings:admin')
  ]
};

/** Overrides for the default `{area}:write` on specific services. */
const WRITE_PERMISSION = {
  workflow: 'workflows:define'
};

/**
 * The full ordered rule list.
 * @const {!Array<Object>}
 */
const RULES = (() => {
  const rules = [
    rule(READ, /^\/api\/monitoring\/.*/, 'monitoring:read'),
    // The MCP endpoint (feature 03) gives an agent the app's tools; administrators only by default.
    rule(['GET', 'POST'], /^\/api\/mcp$/, 'mcp:use'),
    // The API inventory (feature 10) is read-only metadata, granted with monitoring.
    rule(READ, /^\/api\/(openapi\.(json|yaml)|docs(\/app\.js)?)$/, 'monitoring:read')
  ];
  for (const [svc, area] of Object.entries(SERVICE_AREAS)) {
    rules.push(...commonRules(svc, area));
    rules.push(...(SPECIFIC[svc] || []));
    const defaults = defaultRules(svc, area);
    if (WRITE_PERMISSION[svc]) defaults[1].permission = WRITE_PERMISSION[svc];
    rules.push(...defaults);
  }
  return rules;
})();

/**
 * Finds the permission a request needs.
 *
 * @param {string} method - HTTP method
 * @param {string} servicesPath - Path below /services (e.g. '/filing/api/x')
 * @return {?string} The permission, 'public', or null when the path is not an
 *     API route (dashboard pages and assets are the portal guard's job)
 */
function permissionFor(method, servicesPath) {
  const p = String(servicesPath || '');
  const isApi = /^\/[^/]+\/api(\/|$)/.test(p) || /^\/api\//.test(p) || /^\/authservice\/openid/.test(p);
  if (!isApi) return null;
  const m = String(method || 'GET').toUpperCase();
  for (const r of RULES) {
    if (r.methods && !r.methods.includes(m)) continue;
    if (r.pattern.test(p)) return r.permission;
  }
  return undefined;
}

/**
 * Lists registered `/services/*\/api` routes that have no rule.
 *
 * @param {!Array<{method: string, path: string}>} routes - From listRoutes()
 * @return {!Array<string>} 'METHOD /path' for each undeclared route
 */
function listUndeclaredRoutes(routes) {
  const undeclared = [];
  for (const { method, path } of routes) {
    if (!path.startsWith('/services/')) continue;
    // Express params look like ':name'; give them a sample value to match.
    const sample = path.replace(/^\/services/, '').replace(/:[^/]+/g, 'x').replace(/\*/g, 'x');
    if (permissionFor(method, sample) === undefined) {
      undeclared.push(`${method} ${path}`);
    }
  }
  return undeclared;
}

/**
 * Enumerates the routes registered on an Express 4 or 5 app.
 *
 * @param {!Object} app - Express application
 * @return {!Array<{method: string, path: string}>}
 */
function listRoutes(app) {
  const router = app && (app._router || app.router);
  const stack = (router && router.stack) || [];
  const routes = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    // Routes registered through route() are RegExps; route() keeps their pattern (feature 19 audit).
    const routePath = routePathOf(layer.route.path);
    if (!routePath) continue;
    for (const method of Object.keys(layer.route.methods || {})) {
      if (method === '_all') continue;
      routes.push({ method: method.toUpperCase(), path: routePath });
    }
  }
  return routes;
}

module.exports = {
  SERVICE_AREAS,
  RULES,
  permissionFor,
  listUndeclaredRoutes,
  listRoutes
};
