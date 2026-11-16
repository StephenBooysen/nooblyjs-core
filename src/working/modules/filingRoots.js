/**
 * @fileoverview Process-wide registry of filing store roots (feature 18).
 *
 * Filing providers register their root when they are created, so a working
 * service refuses an activities folder that overlaps any store users can write
 * to, even when the two services were wired up separately. Scripts run as code,
 * so they must never live where uploads land.
 *
 * @module working/modules/filingRoots
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** @type {Set<string>} Real paths of every registered filing root. */
const roots = new Set();

/**
 * Resolves a directory to its real path, falling back to the resolved path
 * when it does not exist yet.
 * @param {string} dir - Directory
 * @return {string} Absolute path
 */
function realOrResolved(dir) {
  const resolved = path.resolve(dir);
  try {
    return fs.realpathSync(resolved);
  } catch (_) {
    return resolved;
  }
}

/**
 * Registers a filing store root.
 * @param {string} dir - Filing base directory
 * @return {void}
 */
function registerFilingRoot(dir) {
  if (typeof dir === 'string' && dir.trim() !== '') {
    roots.add(realOrResolved(dir));
  }
}

/**
 * Lists every registered filing root.
 * @return {string[]} Real paths
 */
function listFilingRoots() {
  return Array.from(roots);
}

/**
 * Resolves a directory the way the overlap check compares directories.
 * @param {string} dir - Directory
 * @return {string} Absolute, real path
 */
function normalizeRoot(dir) {
  return realOrResolved(dir);
}

module.exports = { registerFilingRoot, listFilingRoots, normalizeRoot };
