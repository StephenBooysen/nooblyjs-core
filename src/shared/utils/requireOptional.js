/**
 * @fileoverview Loads an optional peer dependency (feature 20b). Cloud SDKs and
 * broker clients are optional peers, installed only by apps that choose the
 * provider; a missing one fails with an install hint instead of a bare
 * "Cannot find module".
 *
 * @module shared/utils/requireOptional
 */

'use strict';

/**
 * Requires an optional package, or throws an error that says how to install it.
 * @param {string} name - Package (or subpath) to require
 * @param {string} usedBy - What needs it, e.g. "filing('s3')"
 * @return {*} The module
 * @throws {Error} code OPTIONAL_DEPENDENCY_MISSING when it is not installed
 * @example
 * const { S3Client } = requireOptional('@aws-sdk/client-s3', "filing('s3')");
 */
function requireOptional(name, usedBy) {
  try {
    return require(name);
  } catch (err) {
    const pkg = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(`'${name}'`)) {
      const error = new Error(`${usedBy} needs the optional package "${pkg}". Install it with: npm install ${pkg}`);
      error.code = 'OPTIONAL_DEPENDENCY_MISSING';
      error.packageName = pkg;
      throw error;
    }
    throw err;
  }
}

module.exports = { requireOptional };
