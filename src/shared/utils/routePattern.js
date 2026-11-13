/**
 * @fileoverview Route patterns that work on Express 4 and Express 5 host apps.
 *
 * The service routes are registered on the HOST's Express app, which may be
 * Express 4 (path-to-regexp 0.1) or Express 5 (path-to-regexp 8). The two
 * disagree on wildcard syntax: Express 4 writes `/files/*` and
 * `/files/:name(*)`, Express 5 `/files/*name`, and Express 5 rejects `:name?`.
 * Both accept a RegExp, so `route()` compiles the Express 4 pattern to one and
 * adds a first handler that gives `req.params` its Express 4 shape again:
 * named params by name, bare `*` wildcards as `req.params[0]`, `[1]`, ….
 *
 *   app.get(...route('/services/filing/api/:instanceName/download/*'), handler)
 *
 * Supported segments: literals, `:name`, `:name?` (optional segment),
 * `:name(*)` (the rest of the path, slashes included) and `*` (the same,
 * unnamed). Matching is case-insensitive and allows a trailing slash, as
 * Express's defaults do.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compiles an Express 4 route pattern.
 *
 * @param {string} pattern - Express 4 style path, e.g. '/api/:instanceName/browse/*'
 * @return {{regexp: RegExp, keys: Array<string|number>}} The regexp and, per capture group, its param key
 */
function compileRoute(pattern) {
  const keys = [];
  let wildcards = 0;
  let source = '';
  for (const segment of pattern.split('/').slice(1)) {
    let match;
    if (segment === '*') {
      keys.push(wildcards++);
      source += '\\/(.*)';
    } else if ((match = /^:([A-Za-z_$][\w$]*)\(\*\)$/.exec(segment))) {
      keys.push(match[1]);
      source += '\\/(.*)';
    } else if ((match = /^:([A-Za-z_$][\w$]*)\?$/.exec(segment))) {
      keys.push(match[1]);
      source += '(?:\\/([^\\/]+?))?';
    } else if ((match = /^:([A-Za-z_$][\w$]*)$/.exec(segment))) {
      keys.push(match[1]);
      source += '\\/([^\\/]+?)';
    } else if (/[*?():]/.test(segment)) {
      throw new Error(`Unsupported route segment "${segment}" in ${pattern}`);
    } else {
      source += `\\/${escapeRegExp(segment)}`;
    }
  }
  return { regexp: new RegExp(`^${source}\\/?$`, 'i'), keys };
}

/**
 * Route path plus params handler, to spread into app.get/post/put/delete.
 *
 * @param {string} pattern - Express 4 style path (see compileRoute)
 * @return {[RegExp, Function]} The path and a handler that names the params
 */
function route(pattern) {
  const { regexp, keys } = compileRoute(pattern);
  // Remember the source pattern, so the route permission check can name this route.
  Object.defineProperty(regexp, 'pattern', { value: pattern, enumerable: false });
  const nameParams = (req, res, next) => {
    // Both versions put the capture groups in req.params[0], [1], … for a RegExp path.
    const groups = keys.map((key, i) => req.params[i]);
    for (const i of keys.keys()) delete req.params[i];
    keys.forEach((key, i) => {
      if (groups[i] !== undefined) req.params[key] = groups[i];
    });
    next();
  };
  return [regexp, nameParams];
}

module.exports = { route, compileRoute };
