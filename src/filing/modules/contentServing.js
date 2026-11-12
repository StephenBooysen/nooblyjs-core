/**
 * @fileoverview Safe serving of user-uploaded files (feature 17, part a).
 *
 * Files in a filing store are user content served from the application
 * origin, the same origin as the /services admin portal. A stored HTML or SVG
 * file served inline would run its script with the viewer's session. So:
 *
 * - Active types (html, htm, xhtml, svg, xml, js, mjs) and unknown types are
 *   always sent as `attachment` with `application/octet-stream`, whatever the
 *   query string says.
 * - Anything served inline also gets a sandboxing Content-Security-Policy, so
 *   even a mislabelled file cannot run script or reach the origin.
 * - Filenames in `Content-Disposition` are encoded per RFC 5987/6266, so quotes
 *   and CR/LF in a key cannot break or inject headers.
 *
 * @module filing/modules/contentServing
 */

'use strict';

/** Extensions → MIME types that are safe to show inline. */
const INLINE_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg'
};

/** Extensions → MIME types that are fine to download but never shown inline. */
const DOWNLOAD_TYPES = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo'
};

/**
 * Policy for inline responses: no script, no plugins, no network, no forms.
 * Images may load from the same origin; inline styles are allowed so text and
 * Markdown previews still look reasonable.
 * @const {string}
 */
const SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

/**
 * Returns the lower-cased extension of a key ('' when there is none).
 *
 * @param {string} key - File key
 * @return {string}
 */
function extensionOf(key) {
  const name = String(key || '').split('/').pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Decides how a file should be served.
 *
 * @param {string} key - File key
 * @param {boolean} wantsAttachment - The caller asked for a download
 * @return {{contentType: string, inline: boolean}}
 */
function servingPolicy(key, wantsAttachment) {
  const ext = extensionOf(key);
  if (Object.prototype.hasOwnProperty.call(INLINE_TYPES, ext)) {
    return { contentType: INLINE_TYPES[ext], inline: !wantsAttachment };
  }
  if (Object.prototype.hasOwnProperty.call(DOWNLOAD_TYPES, ext)) {
    return { contentType: DOWNLOAD_TYPES[ext], inline: false };
  }
  // Active (html, svg, xml, js, …) and unknown types: opaque download only.
  return { contentType: 'application/octet-stream', inline: false };
}

/**
 * Builds a Content-Disposition header value with a safe filename.
 *
 * @param {string} type - 'inline' or 'attachment'
 * @param {string} key - File key (the last segment becomes the filename)
 * @return {string}
 *
 * @example
 * contentDisposition('attachment', 'a/"x".txt');
 * // attachment; filename="_x_.txt"; filename*=UTF-8''%22x%22.txt
 */
function contentDisposition(type, key) {
  const name = String(key || '').split('/').pop() || 'download';
  // ASCII fallback: printable ASCII without quotes or backslashes.
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name)
    .replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Sends file data with safe headers.
 *
 * Non-Buffer data requested inline keeps the existing JSON envelope
 * (`{ data, encoding }`), which is safe because it is JSON.
 *
 * @param {express.Response} res - Express response
 * @param {string} key - File key
 * @param {Buffer|string} data - File contents
 * @param {Object} opts - Options
 * @param {boolean} opts.attachment - The caller asked for a download
 * @param {string=} opts.encoding - The requested encoding, echoed in the JSON envelope
 * @return {void}
 */
function sendFileContent(res, key, data, { attachment, encoding } = {}) {
  const { contentType, inline } = servingPolicy(key, Boolean(attachment));

  if (inline && !Buffer.isBuffer(data)) {
    res.status(200).json({ data, encoding: encoding || 'buffer' });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', SANDBOX_CSP);
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', key));
  res.setHeader('Content-Type', contentType);
  res.send(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
}

module.exports = {
  sendFileContent,
  servingPolicy,
  contentDisposition,
  SANDBOX_CSP
};
