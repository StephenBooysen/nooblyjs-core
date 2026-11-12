/**
 * @fileoverview Document loading and chunking for the knowledge service
 * (feature 05): front matter, HTML to text, and heading-aware chunks with
 * overlap, so each chunk keeps the section it came from.
 *
 * @module knowledge/modules/chunking
 */

'use strict';

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP = 150;

/**
 * Splits a Markdown file into front matter and body. Supports `key: value`
 * pairs and inline lists (`roles: [staff, billing]`); anything more complex is
 * kept as text. A file without front matter has empty metadata.
 *
 * @param {string} text Raw file content.
 * @return {{meta: !Object<string, (string|boolean|Array<string>)>, body: string}}
 */
function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!pair) continue;
    meta[pair[1]] = parseScalarOrList(pair[2]);
  }
  return { meta, body: text.slice(match[0].length) };
}

/**
 * Parses one front-matter value.
 * @param {string} raw
 * @return {string|boolean|Array<string>}
 */
function parseScalarOrList(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((item) => unquote(item.trim())).filter(Boolean);
  }
  if (value === 'true' || value === 'false') return value === 'true';
  return unquote(value);
}

/** Removes one pair of matching quotes. */
function unquote(value) {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/**
 * Turns HTML into readable text: scripts and styles are dropped, block tags
 * become line breaks, other tags are removed, and common entities are decoded.
 *
 * @param {string} html
 * @return {string}
 */
function htmlToText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Splits a long piece of text at paragraph boundaries into pieces of at most
 * `maxChars`, carrying the last `overlap` characters into the next piece.
 *
 * @param {string} text
 * @param {number} maxChars
 * @param {number} overlap
 * @return {Array<string>}
 */
function splitByLength(text, maxChars, overlap) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  let current = '';
  for (const paragraph of paragraphs) {
    // A single paragraph longer than the limit is cut on whitespace.
    const parts = paragraph.length > maxChars ? cutHard(paragraph, maxChars) : [paragraph];
    for (const part of parts) {
      if (current && current.length + part.length + 2 > maxChars) {
        pieces.push(current);
        // The overlap must fit: a piece never grows past maxChars.
        const keep = Math.min(overlap, Math.max(0, maxChars - part.length - 2));
        const tail = keep > 0 ? current.slice(-keep).replace(/^\S*\s/, '') : '';
        current = tail ? `${tail}\n\n${part}` : part;
      } else {
        current = current ? `${current}\n\n${part}` : part;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Cuts text longer than `maxChars` at the last space before the limit.
 * @param {string} text
 * @param {number} maxChars
 * @return {Array<string>}
 */
function cutHard(text, maxChars) {
  const parts = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Splits Markdown into chunks. Headings start a new section, and the heading
 * trail (`Guide > Secrets > Rotation`) is kept with each chunk. A section
 * longer than `maxChars` is split with `overlap` characters repeated.
 *
 * @param {string} body Markdown body (front matter already removed).
 * @param {{maxChars?: number, overlap?: number}=} options
 * @return {Array<{heading: string, text: string}>} Chunks in document order.
 */
function chunkMarkdown(body, { maxChars = DEFAULT_MAX_CHARS, overlap = DEFAULT_OVERLAP } = {}) {
  const trail = [];
  const sections = [];
  let current = { heading: '', lines: [] };
  const flush = () => {
    // A heading with no body of its own adds nothing to retrieval; its title
    // is already in the heading trail of the sections that follow.
    const hasBody = current.lines.some((l) => l.trim() && !/^#{1,6}\s/.test(l));
    const text = current.lines.join('\n').trim();
    if (text && hasBody) sections.push({ heading: current.heading, text });
    current = { heading: '', lines: [] };
  };
  let inFence = false;
  for (const line of String(body).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      trail.length = level - 1;
      trail[level - 1] = heading[2].trim();
      current.heading = trail.filter(Boolean).join(' > ');
      current.lines.push(line);
    } else {
      current.lines.push(line);
    }
  }
  flush();

  const chunks = [];
  for (const section of sections) {
    const pieces = section.text.length > maxChars
      ? splitByLength(section.text, maxChars, overlap)
      : [section.text];
    for (const piece of pieces) {
      chunks.push({ heading: section.heading, text: piece });
    }
  }
  return chunks;
}

module.exports = {
  parseFrontMatter,
  htmlToText,
  chunkMarkdown,
  splitByLength
};
