/**
 * @fileoverview One OpenAPI 3.1 document for a running app (feature 10).
 *
 * The services ship hand-written Swagger documents under
 * `src/{service}/routes/swagger/docs.json`. This module merges them with the
 * routes Express actually mounted:
 *
 * - a documented operation is used when a route with the same method and
 *   path exists (`{param}` and Express `:param`, `:param(*)`, `:param?` are
 *   treated as the same);
 * - a route with no documentation gets a generated stub (`x-generated: true`),
 *   so the document covers every mounted API route;
 * - a documented operation with no matching route is *stale*: it is left out
 *   of the document and reported, and the drift test fails on it.
 *
 * Operations are tagged by service segment (`caching`, `ai`, …). Component
 * names that two documents define differently are prefixed with the service,
 * and references are rewritten to match.
 *
 * @module shared/utils/openapi
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { routePathOf } = require('./routePattern');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/**
 * Services with a hand-written document. `segment` is the URL segment under
 * `/services/` (the AI service is mounted at `/services/ai`).
 * @const {!Array<{dir: string, segment: string}>}
 */
const DOCUMENTED_SERVICES = Object.freeze([
  { dir: 'aiservice', segment: 'ai' },
  { dir: 'caching', segment: 'caching' },
  { dir: 'filing', segment: 'filing' },
  { dir: 'logging', segment: 'logging' },
  { dir: 'measuring', segment: 'measuring' },
  { dir: 'notifying', segment: 'notifying' },
  { dir: 'queueing', segment: 'queueing' },
  { dir: 'workflow', segment: 'workflow' },
  { dir: 'working', segment: 'working' }
]);

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Security requirement for `/services/*\/api` routes: any one credential. */
const API_SECURITY = Object.freeze([
  { ApiKeyAuth: [] },
  { BearerAuth: [] },
  { SessionCookie: [] }
]);

/** Security schemes the app uses, whatever the service documents. */
const SECURITY_SCHEMES = Object.freeze({
  ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'An API key from `security.apiKeyAuth` or `ADMIN_API_KEYS`.' },
  BearerAuth: { type: 'http', scheme: 'bearer', description: 'A personal access token or session token.' },
  SessionCookie: { type: 'apiKey', in: 'cookie', name: 'connect.sid', description: 'The sign-in session cookie set by the dashboards.' }
});

/**
 * Canonical form of a path for comparison: every parameter becomes `{}`, so
 * `{id}`, `:id`, `:id(*)` and `:id?` match, whatever they are named.
 * @param {string} p Path
 * @return {string}
 */
function canonicalPath(p) {
  return String(p).replace(/\{[^}]+\}|:[A-Za-z0-9_]+(\([^)]*\))?\??/g, '{}');
}

/**
 * Converts an Express path to OpenAPI form (`/items/{id}`).
 * @param {string} p Express path
 * @return {string}
 */
function toOpenApiPath(p) {
  return String(p).replace(/:([A-Za-z0-9_]+)(\([^)]*\))?\??/g, '{$1}');
}

/**
 * Lists the API routes mounted on an Express 4 app: everything under
 * `/services/api` or `/services/{service}/api`. Dashboard pages and assets are
 * left out. Routers mounted with `app.use(prefix, router)` are walked, but
 * their mount prefix is not reconstructed, so services mount routes directly.
 *
 * @param {!Object} app Express application
 * @return {!Array<{method: string, path: string}>} Unique method/path pairs
 */
function listApiRoutes(app) {
  const found = new Map();
  const walk = (stack) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const expressPath = routePathOf(layer.route.path);
        if (!expressPath) continue;
        for (const method of Object.keys(layer.route.methods)) {
          const key = `${method.toUpperCase()} ${expressPath}`;
          if (!found.has(key)) found.set(key, { method: method.toUpperCase(), path: expressPath });
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(app && app._router && app._router.stack);
  return Array.from(found.values()).filter((r) => /^\/services\/(api|[^/]+\/api)(\/|$)/.test(r.path));
}

/**
 * Returns the service segment a route belongs to (`platform` for `/services/api`).
 * @param {string} routePath Express path
 * @return {string}
 */
function segmentOf(routePath) {
  const m = /^\/services\/([^/]+)\/api(\/|$)/.exec(routePath);
  return m ? m[1] : 'platform';
}

/**
 * Loads the hand-written documents that exist on disk.
 * @param {string=} root Repository root (defaults to this package)
 * @return {!Array<{segment: string, file: string, doc: !Object}>}
 */
function loadServiceDocs(root = REPO_ROOT) {
  const docs = [];
  for (const { dir, segment } of DOCUMENTED_SERVICES) {
    const file = path.join(root, 'src', dir, 'routes', 'swagger', 'docs.json');
    if (!fs.existsSync(file)) continue;
    docs.push({ segment, file, doc: JSON.parse(fs.readFileSync(file, 'utf8')) });
  }
  return docs;
}

/**
 * Full path a documented path refers to.
 * @param {string} segment Service segment
 * @param {string} docPath Path as written in the document
 * @return {string}
 */
function documentedFullPath(segment, docPath) {
  return docPath.startsWith('/services/') ? docPath : `/services/${segment}/api${docPath}`;
}

/** Deep-clones JSON-compatible data. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Rewrites `$ref`s to renamed components, in place.
 * @param {*} node Value to walk
 * @param {!Map<string, string>} renames `#/components/type/old` → `#/components/type/new`
 */
function rewriteRefs(node, renames) {
  if (Array.isArray(node)) {
    node.forEach((item) => rewriteRefs(item, renames));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && renames.has(value)) {
      node[key] = renames.get(value);
    } else {
      rewriteRefs(value, renames);
    }
  }
}

/**
 * Builds the merged OpenAPI document.
 *
 * @param {Object} input
 * @param {!Array<{method: string, path: string}>} input.routes Mounted API routes
 * @param {!Array<{segment: string, doc: !Object}>} input.docs Service documents
 * @param {string=} input.version App version
 * @return {{document: !Object, stale: !Array<string>, generated: number, documented: number}}
 *     The document; `stale` lists `METHOD /path` documented operations with no route.
 */
function buildOpenApiDocument({ routes, docs, version = '0.0.0' }) {
  // 1. Index documented operations by canonical method + path.
  const documented = new Map();
  const componentOwners = new Map(); // `${type}/${name}` -> JSON of first definition
  const renames = new Map(); // per doc: Map of refs
  const docOps = [];

  for (const { segment, doc } of docs) {
    for (const [docPath, item] of Object.entries(doc.paths || {})) {
      for (const method of HTTP_METHODS) {
        if (!item[method]) continue;
        const key = `${method.toUpperCase()} ${canonicalPath(documentedFullPath(segment, docPath))}`;
        if (documented.has(key)) continue;
        documented.set(key, { segment, op: item[method], method: method.toUpperCase() });
      }
    }
    // Components: keep the first definition; a different one under the same name
    // is renamed with the service segment.
    const localRenames = new Map();
    for (const [type, group] of Object.entries(doc.components || {})) {
      if (type === 'securitySchemes' || !group || typeof group !== 'object') continue;
      for (const [name, def] of Object.entries(group)) {
        const id = `${type}/${name}`;
        const json = JSON.stringify(def);
        if (!componentOwners.has(id)) {
          componentOwners.set(id, json);
        } else if (componentOwners.get(id) !== json) {
          const alias = `${segment}_${name}`;
          const aliasId = `${type}/${alias}`;
          if (!componentOwners.has(aliasId)) componentOwners.set(aliasId, json);
          localRenames.set(`#/components/${type}/${name}`, `#/components/${type}/${alias}`);
        }
      }
    }
    renames.set(segment, localRenames);
    docOps.push({ segment, doc });
  }

  // 2. Build paths from the mounted routes.
  const paths = {};
  const components = { securitySchemes: clone(SECURITY_SCHEMES) };
  const usedOperationIds = new Set();
  const usedKeys = new Set();
  const segments = new Set();
  let generated = 0;
  let documentedCount = 0;

  const addComponents = (segment, doc) => {
    const localRenames = renames.get(segment) || new Map();
    for (const [type, group] of Object.entries(doc.components || {})) {
      if (type === 'securitySchemes' || !group || typeof group !== 'object') continue;
      for (const [name, def] of Object.entries(group)) {
        const target = localRenames.get(`#/components/${type}/${name}`)
          ? `${segment}_${name}`
          : name;
        components[type] = components[type] || {};
        if (!components[type][target]) components[type][target] = clone(def);
      }
    }
  };
  const addedDocs = new Set();

  for (const route of routes) {
    const key = `${route.method} ${canonicalPath(route.path)}`;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    const segment = segmentOf(route.path);
    segments.add(segment);
    const openPath = toOpenApiPath(route.path);
    paths[openPath] = paths[openPath] || {};
    const method = route.method.toLowerCase();

    const hit = documented.get(key);
    let op;
    if (hit) {
      documentedCount += 1;
      op = clone(hit.op);
      rewriteRefs(op, renames.get(hit.segment) || new Map());
      if (!addedDocs.has(hit.segment)) {
        addedDocs.add(hit.segment);
        addComponents(hit.segment, docOps.find((d) => d.segment === hit.segment).doc);
      }
    } else {
      generated += 1;
      const params = [];
      for (const m of route.path.matchAll(/:([A-Za-z0-9_]+)/g)) {
        params.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } });
      }
      op = {
        summary: `${route.method} ${openPath}`,
        description: 'Generated from the mounted route. Add a document under `routes/swagger/` to describe it.',
        parameters: params,
        responses: { 200: { description: 'Success' } },
        'x-generated': true
      };
    }

    op.tags = [segment];
    op.security = op.security || API_SECURITY.map((s) => clone(s));
    op.operationId = uniqueOperationId(op.operationId, segment, method, route.path, usedOperationIds);
    paths[openPath][method] = op;
  }

  // Documents whose operations were all stale still contribute components.
  for (const { segment, doc } of docOps) {
    if (!addedDocs.has(segment)) addComponents(segment, doc);
  }

  // 3. Stale documented operations: documented but not mounted.
  const stale = [];
  for (const key of documented.keys()) {
    if (!usedKeys.has(key)) stale.push(key);
  }

  const tags = Array.from(segments).sort().map((name) => ({
    name,
    description: name === 'platform' ? 'Cross-service endpoints.' : `Operations of the ${name} service.`
  }));

  const document = {
    openapi: '3.1.0',
    info: {
      title: 'NooblyJS API',
      version: String(version),
      description: 'Every API route mounted by this app. Documented operations come from the service documents; `x-generated` marks routes that have no description yet.'
    },
    servers: [{ url: '/', description: 'This server' }],
    tags,
    paths: sortKeys(paths),
    components
  };
  return { document, stale, generated, documented: documentedCount };
}

/**
 * Makes an operation id unique and stable: the documented id when it is free,
 * otherwise a generated one from the service, method and path.
 * @return {string}
 */
function uniqueOperationId(preferred, segment, method, routePath, used) {
  const slug = `${segment}_${method}_${routePath.replace(/^\/services\/([^/]+\/)?api\/?/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}`;
  let id = preferred && !used.has(preferred) ? preferred : slug;
  let n = 2;
  while (used.has(id)) {
    id = `${slug}_${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Returns a copy of an object with its keys sorted, for stable output.
 * @param {!Object} obj
 * @return {!Object}
 */
function sortKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

/**
 * Serialises JSON-compatible data as YAML. Strings are written as JSON strings,
 * which YAML reads as double-quoted scalars, so no escaping rules are needed.
 * @param {*} value
 * @param {number=} indent Current indentation
 * @return {string}
 */
function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const scalar = (v) => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };
  const key = (k) => (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(k) ? k : JSON.stringify(k));
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((item) => {
      if (item && typeof item === 'object') {
        const body = toYaml(item, indent + 2);
        return `${pad}- ${body.trimStart()}`;
      }
      return `${pad}- ${scalar(item)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => {
      if (v && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
        return `${pad}${key(k)}:\n${toYaml(v, indent + 2)}`;
      }
      return `${pad}${key(k)}: ${v && typeof v === 'object' ? (Array.isArray(v) ? '[]' : '{}') : scalar(v)}`;
    }).join('\n');
  }
  return `${pad}${scalar(value)}`;
}

module.exports = {
  buildOpenApiDocument,
  canonicalPath,
  listApiRoutes,
  loadServiceDocs,
  toOpenApiPath,
  toYaml,
  DOCUMENTED_SERVICES,
  API_SECURITY
};
