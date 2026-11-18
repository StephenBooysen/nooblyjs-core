/**
 * @fileoverview Searching service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the Searching service. It registers static routes to serve
 * Searching-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module SearchingViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers Searching service views with the Express application.
 * Sets up static file serving for Searching-related view templates and assets.
 * This function integrates the Searching service views into the main Express
 * application by mounting static file middleware at the '/services/Searching' route.
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} _eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} cache - The Searching service provider instance
 * @returns {void}
 *
 * @example
 * const express = require('express');
 * const app = express();
 * const SearchingViews = require('./src/Searching/views');
 *
 * SearchingViews({
 *   'express-app': app
 * }, eventEmitter, cacheService);
 */
module.exports = (options, eventEmitter, search) => {
  if (options['express-app']) {
    const app = options['express-app'];


    /**
     * GET /services/Searching/scripts
     * Serves the client-side Searching library as JavaScript
     * This endpoint returns the nooblyjsSearching library for use in web applications.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     * @example
     * // Include in HTML:
     * <script src="/services/Searching/scripts"></script>
     *
     * // Use in JavaScript:
     * const cache = new nooblyjsSearching({ instanceName: 'default' });
     * cache.put('key', { data: 'value' });
     * cache.get('key').then(data => console.log(data));
     */
    app.get('/services/searching/scripts', (req, res) => {
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
        eventEmitter.emit('api-Searching-scripts-error', error.message);
        res.status(500).json({ error: 'Failed to load Searching library' });
      }
    });

    /**
     * GET /services/Searching/scripts/test
     * Serves the interactive test page for the Searching library
     * Provides a user-friendly interface for testing all Searching operations.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     * @example
     * // Visit in browser:
     * // http://localhost:3001/services/Searching/scripts/test
     */
    app.get('/services/searching/scripts/test', (req, res) => {
      const fs = require('node:fs');
      const path = require('node:path');

      try {
        // Read the test HTML file
        const testPath = path.join(__dirname, '../scripts/test.html');
        const testHTML = fs.readFileSync(testPath, 'utf8');

        // Set appropriate headers for HTML
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('X-Content-Type-Options', 'nosniff');

        res.status(200).send(testHTML);
      } catch (error) {
        eventEmitter.emit('api-Searching-scripts-test-error', error.message);
        res.status(500).json({ error: 'Failed to load Searching library test page' });
      }
    });

    // Raise an event advising that the script library has loaded
    eventEmitter.emit('search:loading scripts', {
      folder: path.join(__dirname),
    });
  }
};
