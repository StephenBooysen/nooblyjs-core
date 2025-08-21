/**
 * @fileoverview Babel configuration for NooblyJS Core.
 * Configures Babel to transpile modern JavaScript for current Node.js version.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

/**
 * Babel configuration object.
 * Uses @babel/preset-env targeting current Node.js version.
 * @type {Object}
 */
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current',
        },
      },
    ],
  ],
};