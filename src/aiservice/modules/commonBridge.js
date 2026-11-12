/**
 * @fileoverview Loads the ESM `nooblyjs-ai-common` package from CommonJS
 * (feature 02). The package is imported once with dynamic `import()` and the
 * promise is cached, so only the first AI call waits for it.
 *
 * Under Jest, dynamic import needs `--experimental-vm-modules` (the
 * `npm test` script passes it). Without it the error says so.
 *
 * @module aiservice/modules/commonBridge
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const COMMON_ENTRY = pathToFileURL(path.join(__dirname, '..', 'common', 'index.js')).href;

/** @type {?Promise<Object>} */
let loading = null;

/**
 * Returns the nooblyjs-ai-common module namespace.
 * @return {!Promise<Object>}
 */
function loadCommon() {
  if (!loading) {
    loading = import(COMMON_ENTRY).catch((error) => {
      loading = null;
      if (error && error.code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING') {
        const hint = new Error('The AI service loads nooblyjs-ai-common with import(). '
          + 'Under Jest run node with --experimental-vm-modules (see the npm test script).');
        hint.cause = error;
        throw hint;
      }
      throw error;
    });
  }
  return loading;
}

module.exports = { loadCommon, COMMON_ENTRY };
