/**
 * @fileoverview Notifying service scripts module for nooblyjs-core framework.
 * This module provides Express.js static file serving for client-side JavaScript libraries
 * and scripts related to the notifying service. It registers routes to serve the notifying
 * client library through the Express application.
 *
 * @author NooblyJS Core Team
 * @version 1.0.0
 * @since 1.0.0
 * @module NotifyingScripts
 */

'use strict';

const path = require('node:path');
const express = require('express');
const fs = require('node:fs');

/**
 * Registers notifying service scripts with the Express application.
 * Sets up static file serving for notifying-related JavaScript libraries and assets.
 * This function integrates the notifying service client library into the main Express
 * application by mounting static file middleware at the '/services/notifying/scripts' route.
 *
 * Additionally, provides a special endpoint at '/services/notifying/scripts' (without
 * file extension) that serves the main client library as executable JavaScript.
 *
 * @function
 * @param {Object} options - Configuration options for the scripts setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} notifier - The notifying service provider instance
 * @returns {void}
 *
 * @example
 * const express = require('express');
 * const app = express();
 * const notifyingScripts = require('./src/notifying/scripts');
 *
 * notifyingScripts({
 *   'express-app': app
 * }, eventEmitter, notifyingService);
 *
 * // In HTML:
 * // <script src="/services/notifying/scripts"></script>
 * // <script>
 * //   const notifying = new nooblyjsNotifying({ instanceName: 'default' });
 * //   await notifying.createTopic('my-topic');
 * // </script>
 */
module.exports = (options, eventEmitter, notifier) => {
  if (options['express-app']) {
    const app = options['express-app'];
    const scriptsPath = path.join(__dirname);

    // Serve the main notifying client library
    // Access via: <script src="/services/notifying/scripts"></script>
    app.get('/services/notifying/scripts', (req, res) => {
      try {
        const libraryPath = path.join(scriptsPath, 'js', 'index.js');

        // Check if the file exists
        if (!fs.existsSync(libraryPath)) {
          return res.status(404).send('Notifying client library not found');
        }

        // Read the library file
        const libraryContent = fs.readFileSync(libraryPath, 'utf8');

        // Set appropriate headers
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('Access-Control-Allow-Origin', '*'); // Allow cross-origin requests

        res.send(libraryContent);
      } catch (error) {
        console.error('Error serving notifying client library:', error);
        res.status(500).send('Error loading notifying client library');
      }
    });

  }
};
