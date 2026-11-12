'use strict';

/**
 * @fileoverview Jest global setup and teardown that fail the run when a test
 * leaves files outside `.temp/` (feature 22, test hygiene; see
 * .claude/rules/output-locations.md).
 *
 * Setup records the untracked and ignored paths git reports; teardown compares
 * and lists anything new (for example `.application/` or a stray log file).
 * Paths that already existed are not blamed, so a local `.application/` from
 * running the app is fine. Skipped when git is unavailable, or with
 * NOOBLYJS_SKIP_OUTPUT_HYGIENE=1.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const BASELINE = path.join(ROOT, '.temp', 'tests', 'output-hygiene-baseline.json');
const ALLOWED = [/^\.temp\//, /^node_modules\//, /^coverage\//];

/** Untracked and ignored paths, or null when git cannot say. */
function strayPaths() {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=normal'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.split('\n')
      .filter((line) => line.startsWith('?? ') || line.startsWith('!! '))
      .map((line) => line.slice(3).replace(/^"|"$/g, ''))
      .filter((p) => !ALLOWED.some((re) => re.test(p)));
  } catch {
    return null;
  }
}

const skip = () => process.env.NOOBLYJS_SKIP_OUTPUT_HYGIENE === '1';

async function setup() {
  if (skip()) return;
  const paths = strayPaths();
  if (!paths) return;
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(paths));
}

async function teardown() {
  if (skip() || !fs.existsSync(BASELINE)) return;
  const before = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')));
  fs.rmSync(BASELINE, { force: true });
  const now = strayPaths();
  if (!now) return;
  const created = now.filter((p) => !before.has(p) && !before.has(p.replace(/\/$/, '')));
  if (created.length > 0) {
    throw new Error(
      `The test run created files outside .temp/: ${created.join(', ')}. ` +
      'Write test data under testDataDir() (tests/helpers/testData.js) and logs under .temp/logs. ' +
      'Set NOOBLYJS_SKIP_OUTPUT_HYGIENE=1 to skip this check.'
    );
  }
}

module.exports = { setup, teardown, strayPaths };
