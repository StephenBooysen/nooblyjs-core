/**
 * @fileoverview Caching service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the caching service. It registers static routes to serve
 * caching-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module CachingViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers caching service views with the Express application.
 * Sets up static file serving for caching-related view templates and assets.
 * This function integrates the caching service views into the main Express
 * application by mounting static file middleware at the '/services/caching' route.
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} _eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} cache - The caching service provider instance
 * @returns {void}
 *
 * @example
 * const express = require('express');
 * const app = express();
 * const cachingViews = require('./src/caching/views');
 *
 * cachingViews({
 *   'express-app': app
 * }, eventEmitter, cacheService);
 */
module.exports = (options, eventEmitter, cache) => {
  if (options['express-app']) {
    const app = options['express-app'];


    /**
     * GET /services/caching/scripts
     * Serves the client-side caching library as JavaScript
     * This endpoint returns the nooblyjsCaching library for use in web applications.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     * @example
     * // Include in HTML:
     * <script src="/services/caching/scripts"></script>
     *
     * // Use in JavaScript:
     * const cache = new nooblyjsCaching({ instanceName: 'default' });
     * cache.put('key', { data: 'value' });
     * cache.get('key').then(data => console.log(data));
     */
    app.get('/services/caching/scripts', (req, res) => {
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
        eventEmitter.emit('api-caching-scripts-error', error.message);
        res.status(500).json({ error: 'Failed to load caching library' });
      }
    });

    /**
     * GET /services/caching/scripts/test
     * Serves the interactive test page for the caching library
     * Provides a user-friendly interface for testing all caching operations.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     * @example
     * // Visit in browser:
     * // http://localhost:3001/services/caching/scripts/test
     */
    app.get('/services/caching/scripts/test', (req, res) => {
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
        eventEmitter.emit('api-caching-scripts-test-error', error.message);
        res.status(500).json({ error: 'Failed to load caching library test page' });
      }
    });

    // Raise an event advising that the script library has loaded
    eventEmitter.emit('cache:loading scripts', {
      folder: path.join(__dirname),
    });
  }
};
