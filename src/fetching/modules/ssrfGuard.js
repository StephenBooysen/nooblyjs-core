'use strict';

/**
 * @fileoverview SSRF (Server-Side Request Forgery) guard for the fetching service.
 *
 * Validates outbound request URLs before they are dispatched so that a
 * user-supplied URL cannot be used to reach internal infrastructure or the
 * cloud instance metadata endpoint. Two checks are applied:
 *   1. Scheme allow-list — only http: and https: are permitted.
 *   2. Destination IP check — the hostname is resolved (DNS) and every
 *      resulting address is rejected if it falls in a private, loopback,
 *      link-local or unique-local range (this also covers 169.254.169.254).
 *
 * The guard can be relaxed for trusted deployments via options
 * ({@link SsrfOptions}); by default it fails closed.
 *
 * @module fetching/modules/ssrfGuard
 */

const dns = require('node:dns').promises;
const { ClientError } = require('../../shared/utils/httpErrors');
const net = require('node:net');

/**
 * @typedef {Object} SsrfOptions
 * @property {boolean} [allowPrivateNetworks=false] Permit private/loopback/
 *   link-local destinations. Use only for trusted internal fetching.
 * @property {string[]} [allowedHosts] Optional explicit host allow-list. When
 *   set, only these hostnames (exact, case-insensitive) may be fetched.
 * @property {string[]} [allowedProtocols] Override the default ['http:','https:'].
 */

const DEFAULT_PROTOCOLS = ['http:', 'https:'];

/**
 * Determines whether an IPv4 address is in a private / reserved range.
 * @param {string} ip Dotted-quad IPv4 address.
 * @return {boolean} True if the address is private/reserved.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // Treat unparseable as unsafe.
  }
  const [a, b] = parts;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Determines whether an IPv6 address is in a private / reserved range.
 * @param {string} ip IPv6 address.
 * @return {boolean} True if the address is private/reserved.
 */
function isPrivateIPv6(ip) {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone id
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — defer to the IPv4 check.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (addr.startsWith('fe80')) return true; // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
  if (addr.startsWith('ff')) return true; // multicast
  return false;
}

/**
 * Returns true when the given IP literal is private/reserved/unsafe.
 * @param {string} ip IP address literal.
 * @return {boolean} True if unsafe.
 */
function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP → unsafe
}

/**
 * Validates an outbound URL, throwing if it is not safe to fetch.
 *
 * @param {string} rawUrl The URL to validate.
 * @param {SsrfOptions} [options] Guard configuration.
 * @return {Promise<URL>} The parsed, validated URL.
 * @throws {Error} If the URL is malformed, uses a disallowed scheme, is not on
 *   the allow-list, or resolves to a private/reserved address.
 *
 * @example
 * await assertUrlAllowed('https://api.example.com/data');
 */
async function assertUrlAllowed(rawUrl, options = {}) {
  const {
    allowPrivateNetworks = false,
    allowedHosts,
    allowedProtocols = DEFAULT_PROTOCOLS
  } = options;

  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new ClientError(400, 'Blocked request: a URL string is required');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new ClientError(400, 'Blocked request: malformed URL');
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new ClientError(400, `Blocked request: protocol "${parsed.protocol}" is not allowed`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (Array.isArray(allowedHosts) && allowedHosts.length > 0) {
    const allowed = allowedHosts.map((h) => h.toLowerCase());
    if (!allowed.includes(hostname)) {
      throw new ClientError(400, `Blocked request: host "${hostname}" is not on the allow-list`);
    }
    return parsed; // Explicit allow-list overrides IP-range checks.
  }

  if (allowPrivateNetworks) {
    return parsed;
  }

  // Resolve the hostname and ensure no address is private/reserved. If the
  // hostname is already an IP literal, net.isIP short-circuits the lookup.
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true });
      addresses = records.map((r) => r.address);
    } catch (err) {
      throw new ClientError(400, `Blocked request: could not resolve host "${hostname}"`);
    }
  }

  if (addresses.length === 0) {
    throw new ClientError(400, `Blocked request: host "${hostname}" did not resolve`);
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new ClientError(400,
        `Blocked request: host "${hostname}" resolves to a private/reserved address (${address})`
      );
    }
  }

  return parsed;
}


const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * Sends a request and follows redirects by hand, validating every hop.
 *
 * Providers must not let their HTTP client follow redirects: the guard only
 * sees the URL the caller asked for, so a public URL that redirects to a
 * private address would bypass it. Each redirect target is checked with
 * {@link assertUrlAllowed} before it is requested.
 *
 * @param {string} startUrl - The URL the caller asked for (already validated).
 * @param {Object} request - The request to make.
 * @param {string} request.method - HTTP method of the first request.
 * @param {boolean} request.hasBody - Whether the first request carries a body.
 * @param {function(string, {method: string, keepBody: boolean}): Promise<{status: number, location: (string|null), response: *}>} request.send
 *   Performs one hop without following redirects.
 * @param {SsrfOptions} [ssrf] - Options passed to the guard for each hop.
 * @param {number} [maxRedirects=5] - Redirects allowed before failing.
 * @return {Promise<{url: string, response: *}>} The final URL and provider response.
 * @throws {ClientError} 400 when a redirect target is refused or there are too many hops.
 */
async function followRedirects(startUrl, request, ssrf = {}, maxRedirects = MAX_REDIRECTS) {
  let url = startUrl;
  let method = request.method;
  let keepBody = request.hasBody;

  for (let hop = 0; ; hop++) {
    const result = await request.send(url, { method, keepBody });
    if (!REDIRECT_STATUSES.has(result.status) || !result.location) {
      return { url, response: result.response };
    }
    if (hop >= maxRedirects) {
      throw new ClientError(400, 'Too many redirects');
    }

    const next = new URL(result.location, url).toString();
    await assertUrlAllowed(next, ssrf);
    url = next;

    // 301-303 turn anything but GET/HEAD into a GET without a body (fetch and
    // browsers do the same); 307 and 308 keep the method and body.
    if (result.status < 307 && method !== 'GET' && method !== 'HEAD') {
      method = 'GET';
      keepBody = false;
    }
  }
}

module.exports = {
  assertUrlAllowed,
  followRedirects,
  MAX_REDIRECTS,
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6
};
