/**
 * @fileoverview Content-Security-Policy for the NooblyJS dashboards (N-7).
 *
 * Scripts are loaded from files and clicks use data-onclick attributes handled
 * by /services/js/actions.js, so no inline script or inline handler is allowed.
 * Styles still allow 'unsafe-inline' (the dashboards use style attributes). The
 * policy pins every external origin (jsDelivr, unpkg, Google Fonts, Google
 * Analytics), blocks plugins, <base> hijacking and foreign framing, and
 * restricts form targets.
 *
 * Environment:
 *   CSP_MODE          enforce (default) | report-only | off
 *   CSP_EXTRA_SOURCES space-separated origins added to script/style/connect/img
 *
 * @author NooblyJS Team
 * @since 1.1.0
 */

'use strict';

/** Third-party origins the bundled dashboards load from. */
const CDN_SOURCES = ['https://cdn.jsdelivr.net', 'https://unpkg.com'];
const ANALYTICS_SOURCES = ['https://www.googletagmanager.com', 'https://*.google-analytics.com'];

/**
 * Builds the CSP directives.
 *
 * @param {Object} [options] - Options
 * @param {Array<string>} [options.extraSources] - Additional allowed origins
 * @return {Object<string, Array<string>|null>} Directives in helmet format
 */
function buildCspDirectives({ extraSources = [] } = {}) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", ...CDN_SOURCES, ...ANALYTICS_SOURCES, ...extraSources],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'", ...CDN_SOURCES, 'https://fonts.googleapis.com', ...extraSources],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', ...CDN_SOURCES],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:', ...extraSources],
    connectSrc: ["'self'", ...CDN_SOURCES, ...ANALYTICS_SOURCES, ...extraSources],
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],
    // Don't force https:// sub-resources: plain-HTTP deployments (local, behind
    // some proxies) would otherwise break. HSTS covers HTTPS deployments.
    upgradeInsecureRequests: null
  };
}

/**
 * Returns the `contentSecurityPolicy` option for helmet based on CSP_MODE.
 *
 * @param {Object} [env=process.env] - Environment
 * @return {false|{directives: Object, reportOnly: boolean}} helmet option
 *
 * @example
 * app.use(helmet({ contentSecurityPolicy: helmetCspOption() }));
 */
function helmetCspOption(env = process.env) {
  const mode = (env.CSP_MODE || 'enforce').toLowerCase();
  if (mode === 'off') return false;
  const extraSources = (env.CSP_EXTRA_SOURCES || '').split(/\s+/).filter(Boolean);
  return {
    useDefaults: false,
    directives: buildCspDirectives({ extraSources }),
    reportOnly: mode === 'report-only'
  };
}

module.exports = { buildCspDirectives, helmetCspOption };
