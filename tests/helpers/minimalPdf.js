/**
 * @fileoverview Builds a small, valid one-page PDF in memory for tests that need
 * a real PDF (knowledge sources, the filing PDF preview), without a binary
 * fixture in the repo.
 */
'use strict';

/**
 * Escapes text for a PDF literal string.
 * @param {string} text
 * @return {string}
 */
const pdfString = (text) => String(text).replace(/[\\()]/g, (c) => `\\${c}`);

/**
 * @param {string[]} lines Lines of text, drawn top to bottom in Helvetica
 * @param {Object} [options]
 * @param {string} [options.title] Document title (the Info dictionary)
 * @return {Buffer} PDF bytes
 */
function minimalPdf(lines, { title = '' } = {}) {
  const ops = lines.map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 40} Td (${pdfString(line)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (${pdfString(title)}) >>`
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { minimalPdf };
