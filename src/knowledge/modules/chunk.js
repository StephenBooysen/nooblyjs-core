/**
 * @fileoverview Heading-aware Markdown chunking for the knowledge service
 * (feature 05). A chunk never crosses a heading. Long sections split at blank
 * lines, and each chunk after the first repeats the tail of the previous one, so
 * an answer that spans a split can still be found.
 *
 * @author NooblyJS Team
 * @since 1.0.14
 */

'use strict';

const HEADING = /^#{1,6}\s+(.*)$/;

/**
 * Splits Markdown into sections, one per heading.
 * @param {string} text Markdown
 * @return {Array<{heading: string, body: string}>} Sections in order
 */
function sectionsOf(text) {
  const sections = [];
  let current = { heading: '', lines: [] };
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(HEADING);
    if (m) {
      if (current.lines.join('').trim()) sections.push({ heading: current.heading, body: current.lines.join('\n') });
      current = { heading: m[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push({ heading: current.heading, body: current.lines.join('\n') });
  return sections;
}

/**
 * Chunks Markdown.
 *
 * @param {string} text Markdown
 * @param {Object} [options]
 * @param {number} [options.maxChars=1200] Target size of a chunk
 * @param {number} [options.overlapChars=150] Characters carried into the next chunk of the same section
 * @return {Array<{text: string, heading: string}>} Chunks in document order
 */
function chunkMarkdown(text, { maxChars = 1200, overlapChars = 150 } = {}) {
  const limit = Math.max(200, maxChars);
  const overlap = Math.min(Math.max(0, overlapChars), Math.floor(limit / 2));
  const chunks = [];

  for (const section of sectionsOf(text)) {
    const paragraphs = section.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    let buffer = '';
    const flush = () => {
      if (buffer.trim()) chunks.push({ text: buffer.trim(), heading: section.heading });
    };
    for (const paragraph of paragraphs) {
      if (paragraph.length > limit) {
        // A paragraph longer than the limit is cut by characters. A short pending
        // buffer (such as the heading line) leads the first piece; a long one is flushed.
        let prefix = '';
        if (buffer && buffer.length <= limit / 2) prefix = `${buffer}\n\n`;
        else flush();
        buffer = '';
        let pos = 0;
        while (pos < paragraph.length) {
          const room = limit - prefix.length;
          chunks.push({ text: (prefix + paragraph.slice(pos, pos + room)).trim(), heading: section.heading });
          prefix = '';
          if (pos + room >= paragraph.length) break;
          pos += Math.max(1, room - overlap);
        }
        continue;
      }
      if (buffer && buffer.length + paragraph.length + 2 > limit) {
        flush();
        buffer = buffer.slice(-overlap);
        const carried = buffer.trim();
        buffer = carried ? `${carried}\n\n${paragraph}` : paragraph;
      } else {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      }
    }
    flush();
  }
  return chunks.filter((c) => c.text.length > 0);
}

module.exports = { chunkMarkdown, sectionsOf };
