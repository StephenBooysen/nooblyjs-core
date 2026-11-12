/**
 * @fileoverview The code-execution boundary for working, scheduling and
 * workflow (feature 18).
 *
 * Three services run JavaScript files in worker threads, and worker threads
 * have full Node access. This module decides which files may run:
 *
 * - **Over HTTP** (`assertActivityReference`): only a relative path inside the
 *   activities folder, or a registered activity name. Absolute paths, `..`
 *   segments and non-JavaScript files are refused with `ClientError(400)`.
 * - **At execution** (`resolveActivityScript`): relative paths must stay inside
 *   the activities root after following symlinks; absolute paths must sit in
 *   the activities root or a trusted root (the package's built-in activities)
 *   unless `allowAbsolutePaths` is set; and nothing inside a filing store may
 *   run, ever, so an uploaded file can never become code.
 *
 * @module working/modules/activityPath
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ClientError } = require('../../shared/utils/httpErrors');

/** Extensions a worker will run. */
const ACTIVITY_EXTENSIONS = ['.js', '.mjs', '.cjs'];

/** Longest accepted activity reference. */
const MAX_REFERENCE_LENGTH = 500;

/** Activities shipped with this package; always runnable in-process. */
const BUILT_IN_ROOTS = [path.resolve(__dirname, '../../workflow/activities')];

/**
 * Directories that hold user-writable content (filing stores). Scripts under
 * them never run. Filing providers register their roots here on construction.
 * @type {!Set<string>}
 */
const forbiddenRoots = new Set();

/**
 * Activities roots of live working services, so a filing store created later
 * can refuse to overlap one.
 * @type {!Set<string>}
 */
const activityRoots = new Set();

/**
 * Whether `child` is `parent` or inside it.
 *
 * @param {string} child - Absolute path
 * @param {string} parent - Absolute path
 * @return {boolean}
 */
function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves symlinks for a path that may not exist yet, by resolving its
 * nearest existing ancestor and re-appending the rest.
 *
 * @param {string} absPath - Absolute path
 * @return {string} The real path
 */
function realpathLoose(absPath) {
  let current = absPath;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...tail.reverse());
    } catch (err) {
      const parent = path.dirname(current);
      if (parent === current) return absPath;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Throws when two roots overlap (one contains the other).
 *
 * @param {string} activitiesRoot - A working activities root
 * @param {string} filingRoot - A filing store root
 * @throws {Error} On overlap
 */
function assertNoOverlap(activitiesRoot, filingRoot) {
  if (isWithin(activitiesRoot, filingRoot) || isWithin(filingRoot, activitiesRoot)) {
    throw new Error(
      `Unsafe configuration: the working activities folder (${activitiesRoot}) and the filing store ` +
      `(${filingRoot}) overlap. Uploaded files could be run as code. Keep activities in the ` +
      'application image, outside every filing baseDir.'
    );
  }
}

/**
 * Registers a filing store root. Scripts inside it will never run, and a
 * store that overlaps a live activities folder is refused.
 *
 * @param {string} dir - Filing root directory
 * @throws {Error} When the store overlaps an activities folder
 */
function registerFilingRoot(dir) {
  const real = realpathLoose(path.resolve(dir));
  for (const root of activityRoots) {
    assertNoOverlap(root, real);
  }
  forbiddenRoots.add(real);
}

/**
 * Registers a working service's activities root. Refused when it overlaps a
 * registered filing store.
 *
 * @param {string} dir - Activities root directory
 * @return {string} The real path that was registered
 * @throws {Error} When the folder overlaps a filing store
 */
function registerActivitiesRoot(dir) {
  const real = realpathLoose(path.resolve(dir));
  for (const root of forbiddenRoots) {
    assertNoOverlap(real, root);
  }
  activityRoots.add(real);
  return real;
}

/**
 * Validates an activity reference arriving over HTTP. Pure: it does not touch
 * the filesystem; containment is enforced again at execution.
 *
 * @param {*} ref - The `scriptPath` (or step) from the request
 * @param {Object=} opts - Options
 * @param {Object<string, string>=} opts.registry - Named activities; when set,
 *     only registered names are accepted
 * @param {string=} opts.field - Field name for error messages
 * @return {string} The reference, trimmed
 * @throws {ClientError} 400 when the reference is unsafe
 *
 * @example
 * assertActivityReference('reports/nightly.js'); // ok
 * assertActivityReference('/etc/passwd');        // throws
 * assertActivityReference('../../index.js');     // throws
 */
function assertActivityReference(ref, opts = {}) {
  const field = opts.field || 'scriptPath';
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new ClientError(400, `${field} must be a non-empty string`);
  }
  const value = ref.trim();
  if (value.length > MAX_REFERENCE_LENGTH || value.includes('\0')) {
    throw new ClientError(400, `${field} is not a valid activity`);
  }

  const registry = opts.registry;
  if (registry && Object.keys(registry).length > 0) {
    if (!Object.prototype.hasOwnProperty.call(registry, value)) {
      throw new ClientError(400, `${field} must be the name of a registered activity`);
    }
    return value;
  }

  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || normalized.startsWith('/')) {
    throw new ClientError(400, `${field} must be a path relative to the activities folder`);
  }
  if (normalized.split('/').includes('..')) {
    throw new ClientError(400, `${field} must not contain ".." segments`);
  }
  if (!ACTIVITY_EXTENSIONS.includes(path.extname(normalized).toLowerCase())) {
    throw new ClientError(400, `${field} must be a .js, .mjs or .cjs file`);
  }
  return value;
}

/**
 * Resolves an activity reference to the script a worker will run.
 *
 * @param {string} ref - Activity name, relative path, or (in-process) absolute path
 * @param {Object} opts - Options
 * @param {string} opts.root - Activities root (absolute or relative to cwd)
 * @param {Object<string, string>=} opts.registry - Named activities (name → path)
 * @param {Array<string>=} opts.trustedRoots - Extra roots absolute paths may use
 * @param {boolean=} opts.allowAbsolutePaths - Accept any absolute path (deprecated)
 * @return {string} The resolved absolute path
 * @throws {ClientError} 400 when the reference is not allowed
 */
function resolveActivityScript(ref, opts) {
  if (typeof ref !== 'string' || ref.trim() === '' || ref.includes('\0')) {
    throw new ClientError(400, 'scriptPath must be a non-empty string');
  }
  const root = path.resolve(process.cwd(), opts.root || 'activities');
  const realRoot = realpathLoose(root);
  const registry = opts.registry || null;

  let candidate;
  let trusted = false;
  if (registry && Object.prototype.hasOwnProperty.call(registry, ref)) {
    // Operator-configured mapping: trusted, but still never a filing file.
    candidate = path.resolve(process.cwd(), registry[ref]);
    trusted = true;
  } else if (path.isAbsolute(ref)) {
    candidate = path.resolve(ref);
  } else {
    candidate = path.resolve(root, ref);
    if (!isWithin(candidate, root)) {
      throw new ClientError(400, 'Activity path escapes the activities folder');
    }
  }

  if (!ACTIVITY_EXTENSIONS.includes(path.extname(candidate).toLowerCase())) {
    throw new ClientError(400, 'Activities must be .js, .mjs or .cjs files');
  }

  const real = realpathLoose(candidate);
  for (const forbidden of forbiddenRoots) {
    if (isWithin(real, forbidden)) {
      throw new ClientError(400, 'Activities cannot run from a filing store');
    }
  }

  if (!trusted) {
    const allowedRoots = [realRoot, ...BUILT_IN_ROOTS.map(realpathLoose),
      ...(opts.trustedRoots || []).map((r) => realpathLoose(path.resolve(process.cwd(), r)))];
    const inside = allowedRoots.some((r) => isWithin(real, r));
    if (!inside) {
      if (path.isAbsolute(ref) && opts.allowAbsolutePaths) {
        return candidate;
      }
      throw new ClientError(400, path.isAbsolute(ref)
        ? 'Absolute activity paths outside the activities folder are not allowed (set allowAbsolutePaths or trustedRoots)'
        : 'Activity path escapes the activities folder');
    }
  }
  return candidate;
}

/**
 * Clears registered roots. For tests.
 * @return {void}
 */
function resetRegisteredRoots() {
  forbiddenRoots.clear();
  activityRoots.clear();
}

module.exports = {
  ACTIVITY_EXTENSIONS,
  assertActivityReference,
  resolveActivityScript,
  registerFilingRoot,
  registerActivitiesRoot,
  resetRegisteredRoots,
  isWithin
};
