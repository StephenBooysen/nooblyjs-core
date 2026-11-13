/**
 * @fileoverview Loads an optional (peer) dependency on first use.
 *
 * Cloud SDKs and database drivers are optional peer dependencies, so a plain
 * `npm install nooblyjs-core` installs none of them. Providers call this when
 * they are constructed, so the package is needed only when that provider is
 * chosen, and a missing one fails with an install hint.
 *
 * @author NooblyJS Team
 * @since 1.0.11
 */

'use strict';

/**
 * Requires a module that may not be installed.
 *
 * @param {string} name Package name, for example `@aws-sdk/client-s3`
 * @param {string} feature Human-readable provider name, for the error message
 * @return {Object} The loaded module exports
 * @throws {Error} When the package is not installed
 * @example
 * const { S3Client } = loadOptionalModule('@aws-sdk/client-s3', 'S3 filing');
 */
function loadOptionalModule(name, feature) {
  try {
    return require(name);
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(`'${name}'`)) {
      throw new Error(`The ${feature} provider needs the "${name}" package. Install it with: npm install ${name}`);
    }
    throw err;
  }
}

module.exports = { loadOptionalModule };
