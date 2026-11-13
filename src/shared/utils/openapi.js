/**
 * @fileoverview One OpenAPI 3.1 document for a running app (feature 10).
 *
 * Each service keeps its own `routes/swagger/docs.json` (OpenAPI 3.0 style, with
 * paths relative to its base). This module merges the documents of the services
 * an app has mounted into one 3.1 document: paths are absolute, schema names are
 * prefixed per service so they cannot collide, security schemes use one name each,
 * and every operation is tagged by service.
 *
 * It also compares documented operations with the routes Express registered, so
 * a test can fail when the two drift apart.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SERVICE_PREFIX = /^\/services\/([^/]+)\/api/;
const COMPONENT_GROUPS = ['schemas', 'parameters', 'responses', 'requestBodies', 'examples', 'headers'];

/** Security scheme names used across the service documents, mapped to one name each. */
const SCHEME_ALIASES = {
  ApiKeyAuth: 'ApiKeyAuth',
  ApiKey: 'ApiKeyAuth',
  apiKey: 'ApiKeyAuth',
  ApiKeyHeader: 'ApiKeyAuth',
  ApiKeyQuery: 'ApiKeyAuth',
  BearerAuth: 'BearerAuth',
  bearerToken: 'BearerAuth'
};

const CANONICAL_SCHEMES = {
  ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'API key sent in the x-api-key header (or api-key header).' },
  BearerAuth: { type: 'http', scheme: 'bearer', description: 'Personal access token or API key sent as a Bearer token.' },
  SessionCookie: { type: 'apiKey', in: 'cookie', name: 'connect.sid', description: 'Browser session cookie set by sign-in (HttpOnly, SameSite=Strict).' }
};

/** Capitalises a service name for tags and schema prefixes: "queueing" -> "Queueing". */
const titleCase = (name) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * Works out the absolute base a service's document is mounted under.
 * Documents use either a `servers` url of `/services/{name}/api` or paths that
 * already start with `/services/`; anything else falls back to the directory name.
 *
 * @param {Object} doc Parsed service document
 * @param {string} dirName Service directory name, e.g. "aiservice"
 * @return {string} Base such as `/services/ai/api`
 */
function serviceBase(doc, dirName) {
  const url = doc.servers?.[0]?.url || '';
  const fromServer = url.match(SERVICE_PREFIX);
  if (fromServer) return `/services/${fromServer[1]}/api`;
  const fromPath = Object.keys(doc.paths || {}).find((p) => p.startsWith('/services/'));
  const fromPathMatch = fromPath && fromPath.match(SERVICE_PREFIX);
  if (fromPathMatch) return `/services/${fromPathMatch[1]}/api`;
  return `/services/${dirName}/api`;
}

/**
 * Returns an operation id not used yet. Operations shared by a default and a
 * `{instanceName}` route reuse one id in the service document, so later copies
 * get the service title and then a counter.
 *
 * @param {string} base Preferred id
 * @param {string} title Service title
 * @param {Set<string>} used Ids already used (mutated)
 * @return {string} Unique id
 */
function uniqueOperationId(base, title, used) {
  let id = base;
  if (used.has(id)) id = `${base}_${title}`;
  for (let n = 2; used.has(id); n += 1) id = `${base}_${title}_${n}`;
  used.add(id);
  return id;
}

/**
 * Rewrites every `#/components/<group>/<name>` reference in a value, prefixing names.
 * @param {*} value Any JSON value
 * @param {string} prefix Prefix added to component names
 * @return {*} A new value with references rewritten
 */
function rewriteRefs(value, prefix) {
  if (Array.isArray(value)) return value.map((v) => rewriteRefs(v, prefix));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string') {
        out[k] = v.replace(/^#\/components\/(schemas|parameters|responses|requestBodies|examples|headers)\/(.+)$/, (m, group, name) => `#/components/${group}/${prefix}${name}`);
      } else {
        out[k] = rewriteRefs(v, prefix);
      }
    }
    return out;
  }
  return value;
}

/**
 * Lists the operations a document declares, as `METHOD /absolute/path` with
 * `{param}` placeholders kept as written.
 *
 * @param {Object} doc Parsed service document
 * @param {string} dirName Service directory name
 * @return {string[]} Operation keys
 */
function documentedOperations(doc, dirName) {
  const base = serviceBase(doc, dirName);
  const ops = [];
  for (const [p, item] of Object.entries(doc.paths || {})) {
    const full = p.startsWith('/services/') ? p : `${base}${p}`;
    for (const method of Object.keys(item)) {
      if (['get', 'put', 'post', 'delete', 'patch', 'head', 'options'].includes(method)) {
        ops.push(operationKey(method, full));
      }
    }
  }
  return ops;
}

/**
 * Turns an Express-style path into the OpenAPI style: `:name`, `:name?` and
 * `:name(*)` become `{name}`, and a bare `*` becomes `{path}`.
 *
 * @param {string} p Express path
 * @return {string} OpenAPI path
 */
function toOpenApiPath(p) {
  return p
    .replace(/:([A-Za-z0-9_]+)(\(\*\))?\??/g, '{$1}')
    .replace(/\*/g, '{path}');
}

/**
 * Key used to compare a documented operation with a registered route: the
 * method plus the path with every parameter replaced by `{}`.
 *
 * @param {string} method HTTP method, any case
 * @param {string} p Express or OpenAPI path
 * @return {string} Comparison key such as `GET /services/caching/api/get/{}`
 */
function operationKey(method, p) {
  return `${method.toUpperCase()} ${toOpenApiPath(p).replace(/\{[^}]+\}/g, '{}')}`;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

/**
 * Adds a generated stub for every registered route that has no documented
 * operation. The stub names the operation, tags it by service, and carries the
 * route's security requirement, so the merged document lists every route.
 *
 * @param {Object} paths Paths object being built (mutated)
 * @param {Array<{method: string, pattern: string, permission: ?string}>} routes Registered routes
 * @param {Array<{name: string}>} tags Tag list (mutated)
 * @param {Set<string>|null} mounted Mounted bases, or null for all
 * @param {Set<string>} usedSchemes Scheme names in use (mutated)
 * @param {Set<string>} operationIds Operation ids already used (mutated)
 * @return {void}
 */
/**
 * Converts one validate() field rule into an OpenAPI schema.
 * @param {Object} rule Field rule ({type, required, enum, minLength, maxLength, min, max})
 * @return {Object} Schema object
 */
function ruleToSchema(rule = {}) {
  const type = ['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(rule.type) ? rule.type : 'string';
  const out = { type };
  if (rule.enum) out.enum = rule.enum;
  if (rule.minLength !== undefined) out[type === 'array' ? 'minItems' : 'minLength'] = rule.minLength;
  if (rule.maxLength !== undefined) out[type === 'array' ? 'maxItems' : 'maxLength'] = rule.maxLength;
  if (rule.min !== undefined) out.minimum = rule.min;
  if (rule.max !== undefined) out.maximum = rule.max;
  return out;
}

/**
 * Builds OpenAPI parameters and a request body from a route's validate() schema.
 * @param {string} full OpenAPI path, for example /services/x/api/items/{id}
 * @param {Object} schema validate() rules ({params, query, body})
 * @return {{parameters: Array<Object>, requestBody: ?Object}}
 */
function parametersFromSchema(full, schema) {
  const parameters = [];
  const pathNames = new Set([...full.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
  for (const [name, rule] of Object.entries(schema.params || {})) {
    parameters.push({ name, in: 'path', required: true, schema: ruleToSchema(rule) });
    pathNames.delete(name);
  }
  // Path placeholders with no rule are still required parameters.
  for (const name of pathNames) parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
  for (const [name, rule] of Object.entries(schema.query || {})) {
    parameters.push({ name, in: 'query', required: Boolean(rule.required), schema: ruleToSchema(rule) });
  }
  let requestBody = null;
  if (schema.body) {
    const properties = {};
    const required = [];
    for (const [name, rule] of Object.entries(schema.body)) {
      properties[name] = ruleToSchema(rule);
      if (rule.required) required.push(name);
    }
    requestBody = {
      required: required.length > 0,
      content: { 'application/json': { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } }
    };
  }
  return { parameters, requestBody };
}

/**
 * Every `{name}` in a path must be declared as a path parameter. Documented
 * operations that leave one out get a plain string parameter, so the document
 * stays valid without rewriting each service's own file.
 *
 * @param {Object} paths OpenAPI paths object (mutated)
 * @return {void}
 */
function declarePathPlaceholders(paths) {
  for (const [p, item] of Object.entries(paths)) {
    const names = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    if (names.length === 0) continue;
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const op = item[method];
      op.parameters = op.parameters || [];
      const declared = new Set(op.parameters.filter((x) => x && x.in === 'path').map((x) => x.name));
      for (const name of names) {
        if (!declared.has(name)) op.parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
      }
    }
  }
}

function addUndocumentedStubs(paths, routes, tags, mounted, usedSchemes, operationIds) {
  const documented = new Set();
  for (const [p, item] of Object.entries(paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.includes(method)) documented.add(operationKey(method, p));
    }
  }
  for (const name of ['ApiKeyAuth', 'BearerAuth', 'SessionCookie']) usedSchemes.add(name);

  for (const route of routes) {
    const method = String(route.method || '').toLowerCase();
    if (!HTTP_METHODS.includes(method) || !route.pattern) continue;
    const base = route.pattern.match(SERVICE_PREFIX);
    if (mounted && base && !mounted.has(`/services/${base[1]}/api`)) continue;
    if (documented.has(operationKey(method, route.pattern))) continue;

    const full = toOpenApiPath(route.pattern);
    const title = titleCase(base ? base[1] : 'app');
    if (!tags.some((t) => t.name === title)) tags.push({ name: title, description: `${title} routes` });

    const opId = uniqueOperationId(`${method}_${full.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`, title, operationIds);

    const isPublic = route.permission === 'public';
    const target = paths[full] || (paths[full] = {});
    const shape = parametersFromSchema(full, route.schema || {});
    target[method] = {
      tags: [title],
      summary: `${route.method.toUpperCase()} ${full}`,
      description: 'Not described in the service documentation yet. The route exists and its permission is checked by the app; see the route source for input and output.',
      operationId: opId,
      security: isPublic ? [] : [{ ApiKeyAuth: [] }, { BearerAuth: [] }, { SessionCookie: [] }],
      ...(shape.parameters.length ? { parameters: shape.parameters } : {}),
      ...(shape.requestBody ? { requestBody: shape.requestBody } : {}),
      responses: { 200: { description: 'Success' } },
      'x-undocumented': true,
      'x-permission': route.permission || null
    };
  }
}

/**
 * Lists registered API routes that have no documented operation, as comparison keys.
 * This is the drift check: the authored documents should describe every route.
 *
 * @param {Array<{method: string, pattern: string}>} routes Registered routes
 * @param {Array<{dir: string, doc: Object}>} services Service documents
 * @return {string[]} Keys `METHOD /services/x/api/...`, sorted
 */
function undocumentedRoutes(routes, services) {
  const documented = new Set();
  for (const s of services) for (const op of documentedOperations(s.doc, s.dir)) documented.add(op);
  const missing = new Set();
  for (const r of routes) {
    if (!r.pattern || !HTTP_METHODS.includes(String(r.method).toLowerCase())) continue;
    const key = operationKey(r.method, r.pattern);
    if (!documented.has(key)) missing.add(key);
  }
  return [...missing].sort();
}

/**
 * Lists documented operations that no registered route answers, as comparison keys.
 * @param {Array<{method: string, pattern: string}>} routes Registered routes
 * @param {Array<{dir: string, doc: Object}>} services Service documents
 * @return {string[]} Keys, sorted
 */
function routelessDocumentation(routes, services) {
  const registered = new Set(routes.filter((r) => r.pattern).map((r) => operationKey(r.method, r.pattern)));
  const out = new Set();
  for (const s of services) {
    for (const op of documentedOperations(s.doc, s.dir)) if (!registered.has(op)) out.add(op);
  }
  return [...out].sort();
}

/**
 * Merges service documents into one OpenAPI 3.1 document.
 *
 * @param {Object} options
 * @param {Array<{dir: string, doc: Object}>} options.services Service documents; `dir` is the service directory name
 * @param {Set<string>|null} [options.mounted] Mounted bases such as `/services/ai/api`; null includes every service
 * @param {{title?: string, version?: string, description?: string}} [options.info]
 * @param {Array<{method: string, pattern: string, permission: ?string}>} [options.routes] Registered API routes
 *   (from `listApiRoutes`). Routes without a documented operation get a generated stub, marked `x-undocumented`.
 * @param {string} [options.serverUrl='/'] Server URL for the document
 * @return {Object} OpenAPI 3.1 document
 */
function buildOpenApiDocument({ services, mounted = null, routes = null, info = {}, serverUrl = '/' }) {
  const paths = {};
  const components = {};
  const tags = [];
  const usedSchemes = new Set();
  const operationIds = new Set();

  for (const { dir, doc } of services) {
    const base = serviceBase(doc, dir);
    if (mounted && !mounted.has(base)) continue;
    const title = titleCase(dir);
    const prefix = `${title}_`;
    tags.push({ name: title, description: doc.info?.description || `${title} service` });

    for (const [p, item] of Object.entries(doc.paths || {})) {
      const full = toOpenApiPath(p.startsWith('/services/') ? p : `${base}${p}`);
      const target = paths[full] || (paths[full] = {});
      for (const [method, op] of Object.entries(item)) {
        if (!['get', 'put', 'post', 'delete', 'patch', 'head', 'options'].includes(method)) {
          target[method] = op;
          continue;
        }
        const rewritten = rewriteRefs(JSON.parse(JSON.stringify(op)), prefix);
        rewritten.tags = [title];
        if (Array.isArray(rewritten.security)) {
          rewritten.security = rewritten.security.map((req) => {
            const out = {};
            for (const name of Object.keys(req)) {
              const canonical = SCHEME_ALIASES[name] || name;
              usedSchemes.add(canonical);
              out[canonical] = req[name];
            }
            return out;
          });
        }
        rewritten.operationId = uniqueOperationId(rewritten.operationId || `${method}${title}`, title, operationIds);
        target[method] = rewritten;
      }
    }

    for (const group of COMPONENT_GROUPS) {
      for (const [name, value] of Object.entries(doc.components?.[group] || {})) {
        components[group] = components[group] || {};
        components[group][`${prefix}${name}`] = rewriteRefs(value, prefix);
      }
    }
  }

  if (routes) addUndocumentedStubs(paths, routes, tags, mounted, usedSchemes, operationIds);
  declarePathPlaceholders(paths);

  const securitySchemes = {};
  for (const name of usedSchemes) {
    if (CANONICAL_SCHEMES[name]) securitySchemes[name] = CANONICAL_SCHEMES[name];
  }

  if (Object.keys(securitySchemes).length) components.securitySchemes = securitySchemes;

  return {
    openapi: '3.1.0',
    info: {
      title: info.title || 'NooblyJS Core API',
      version: info.version || '1.0.0',
      description: info.description || 'REST API of the services mounted in this app. Each operation is tagged by service.'
    },
    servers: [{ url: serverUrl }],
    tags,
    paths,
    components
  };
}

/**
 * Loads every `routes/swagger/docs.json` under the source tree.
 *
 * @param {string} srcDir Path to `src/`
 * @return {Array<{dir: string, doc: Object}>} Service documents
 */
function loadServiceDocuments(srcDir) {
  const out = [];
  for (const dir of fs.readdirSync(srcDir).sort()) {
    const file = path.join(srcDir, dir, 'routes', 'swagger', 'docs.json');
    if (!fs.existsSync(file)) continue;
    out.push({ dir, doc: JSON.parse(fs.readFileSync(file, 'utf8')) });
  }
  return out;
}

/**
 * Finds the `/services/{name}/api` bases an Express app has mounted routes under.
 *
 * @param {Object} app Express application
 * @return {Set<string>} Mounted bases
 */
function mountedBases(app) {
  const stack = app?._router?.stack || app?.router?.stack || [];
  const bases = new Set();
  for (const layer of stack) {
    const paths = layer.route ? [].concat(layer.route.path) : [];
    for (const p of paths) {
      if (typeof p !== 'string') continue;
      const m = p.match(SERVICE_PREFIX);
      if (m) bases.add(`/services/${m[1]}/api`);
    }
  }
  return bases;
}

module.exports = {
  buildOpenApiDocument,
  routelessDocumentation,
  undocumentedRoutes,
  documentedOperations,
  loadServiceDocuments,
  mountedBases,
  operationKey,
  serviceBase,
  toOpenApiPath
};
