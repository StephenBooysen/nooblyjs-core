'use strict';

/**
 * @fileoverview Safe delivery of stored user files (feature 17).
 *
 * A stored HTML or SVG file served from the portal origin runs its script with
 * the admin's session. The rules here stop that:
 *
 * - **Active or unknown types** (html, svg, xml, js, anything not on the list)
 *   are always downloads, sent as `application/octet-stream`, whatever the
 *   query string asks for.
 * - **Inline types** (pdf, images, plain text, csv, json) are sent inline with a
 *   sandbox CSP and `nosniff`. Even if a browser sniffed markup in them, a
 *   sandboxed document cannot run script or reach the portal.
 * - **Filenames** are encoded per RFC 5987, so quotes and CR/LF cannot break
 *   the Content-Disposition header.
 *
 * @module filing/modules/contentDelivery
 */

const path = require('node:path');

/** Extensions that a browser would render or execute as active content. */
const ACTIVE_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'xht', 'xml', 'xsl', 'xslt',
  'svg', 'svgz', 'js', 'mjs', 'cjs', 'jsx'
]);

/** Extensions that are safe to show inline under the sandbox policy. */
const INLINE_SAFE_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff',
  'txt', 'md', 'csv', 'json'
]);

/** CSP for inline responses: no script, no plugins, no framing, no navigation. */
const SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

/**
 * Encodes a filename for a Content-Disposition header (RFC 5987 `filename*`),
 * with an ASCII fallback that cannot contain quotes or control characters.
 *
 * @param {string} disposition - 'attachment' or 'inline'
 * @param {string} filename - The file's base name
 * @return {string} The header value
 *
 * @example
 * contentDisposition('attachment', 'report "final".pdf');
 * // attachment; filename="report _final_.pdf"; filename*=UTF-8''report%20%22final%22.pdf
 */
function contentDisposition(disposition, filename) {
  const fallback = String(filename)
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(String(filename))
    .replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Decides how a file is delivered.
 *
 * @param {string} key - The file key or path
 * @param {boolean} attachment - Whether the caller asked for a download
 * @param {string} mimeType - The MIME type for the file's extension
 * @return {{disposition: string, contentType: string, sandbox: boolean}}
 *
 * @example
 * deliveryPolicy('site/index.html', false, 'text/html');
 * // { disposition: 'attachment', contentType: 'application/octet-stream', sandbox: false }
 */
function deliveryPolicy(key, attachment, mimeType) {
  const ext = path.extname(String(key)).slice(1).toLowerCase();
  const forceDownload = ACTIVE_EXTENSIONS.has(ext) || !INLINE_SAFE_EXTENSIONS.has(ext);

  if (forceDownload) {
    return { disposition: 'attachment', contentType: 'application/octet-stream', sandbox: false };
  }
  if (attachment) {
    return { disposition: 'attachment', contentType: mimeType, sandbox: false };
  }
  return { disposition: 'inline', contentType: mimeType, sandbox: true };
}

/**
 * Sends a stored file with the delivery policy applied. Non-buffer data keeps
 * the existing shapes: plain text for downloads, JSON otherwise.
 *
 * @param {express.Response} res - Express response
 * @param {string} key - The file key or path
 * @param {Buffer|string|*} data - The file content
 * @param {Object} opts
 * @param {boolean} opts.attachment - Whether the caller asked for a download
 * @param {string=} opts.encoding - Encoding the caller requested, echoed in JSON
 * @param {string} opts.mimeType - MIME type for the file's extension
 * @return {void}
 */
function sendFileContent(res, key, data, { attachment, encoding, mimeType }) {
  if (!Buffer.isBuffer(data)) {
    if (attachment) {
      res.setHeader('Content-Type', 'text/plain');
      res.send(data);
      return;
    }
    res.status(200).json({ data, encoding: encoding || 'buffer' });
    return;
  }

  const policy = deliveryPolicy(key, attachment, mimeType);
  const filename = String(key).split('/').pop() || 'download';

  res.setHeader('Content-Type', policy.contentType);
  res.setHeader('Content-Disposition', contentDisposition(policy.disposition, filename));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (policy.sandbox) {
    res.setHeader('Content-Security-Policy', SANDBOX_CSP);
  }
  res.send(data);
}

module.exports = {
  sendFileContent,
  deliveryPolicy,
  contentDisposition,
  SANDBOX_CSP
};
