'use strict';

/**
 * @fileoverview Feature 17b: the style policy has no 'unsafe-inline'. Markup
 * under src/ and public/ carries no style attributes and no <style> blocks,
 * so the CSP can refuse inline styles. JavaScript may still set styles through
 * element.style (CSSOM), which CSP does not block.
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildCspDirectives } = require('../../../src/shared/utils/contentSecurityPolicy');

const ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['src', 'public'];
const STYLE_ATTR = /\sstyle\s*=\s*["']/;
const STYLE_TAG = /<style[\s>]/i;
const STYLE_SET_ATTR = /setAttribute\(\s*['"]style['"]/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(html|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('feature 17b — no inline styles in markup', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no style attributes', () => {
    const hits = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')
      .map((line, i) => (STYLE_ATTR.test(line) ? `${path.relative(ROOT, f)}:${i + 1}` : null))
      .filter(Boolean));
    expect(hits).toEqual([]);
  });

  it('has no <style> blocks', () => {
    const hits = files.filter((f) => STYLE_TAG.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('does not write style attributes with setAttribute', () => {
    const hits = files.filter((f) => STYLE_SET_ATTR.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});

describe('feature 17b — the style policy', () => {
  it('does not allow unsafe-inline for styles', () => {
    const styleSrc = buildCspDirectives().styleSrc;
    expect(styleSrc).not.toContain("'unsafe-inline'");
    expect(styleSrc).toContain("'self'");
  });
});
