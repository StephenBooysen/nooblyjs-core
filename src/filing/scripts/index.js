/**
 * @fileoverview Filing service views module for nooblyjs-core framework.
 * This module provides Express.js view for file serving capabilities for the filing service. 
 * It registers static routes to serve filing-related view through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module FilingViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers filing service views with the Express application.
 * Sets up static file serving for filing-related view templates and assets.
 * This function integrates the filing service views into the main Express
 * application by mounting static file middleware at the '/services/filing' route.
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} _eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} cache - The filing service provider instance
 * @returns {void}
 *
 * @example
 * const express = require('express');
 * const app = express();
 * const filingViews = require('./src/filing/views');
 *
 * filingViews({
 *   'express-app': app
 * }, eventEmitter, cacheService);
 */
module.exports = (options, eventEmitter, cache) => {
  if (options['express-app']) {
    const app = options['express-app'];


    /**
     * GET /services/filing/scripts
     * Serves the client-side filing library as JavaScript
     * This endpoint returns the nooblyjsfiling library for use in web applications.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     * @example
     * // Include in HTML:
     * <script src="/services/filing/scripts"></script>
     *
     * // Use in JavaScript:
     * const cache = new nooblyjsfiling({ instanceName: 'default' });
     * cache.put('key', { data: 'value' });
     * cache.get('key').then(data => console.log(data));
     */
    app.get('/services/filing/scripts', (req, res) => {
      const fs = require('node:fs');
      const path = require('node:path');

      try {
        // Read the client library file
        const libraryPath = path.join(__dirname, './js/index.js');
        const libraryCode = fs.readFileSync(libraryPath, 'utf8');

        // Set appropriate headers for JavaScript
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('X-Content-Type-Options', 'nosniff');

        res.status(200).send(libraryCode);
      } catch (error) {
        eventEmitter.emit('api-filing-scripts-error', error.message);
        res.status(500).json({ error: 'Failed to load filing library' });
      }
    });

    // Raise an event advising that the script library has loaded
    eventEmitter.emit('filing:loading scripts', {
      folder: path.join(__dirname),
    });
  }
};
