/**
 * @fileoverview Scheduling service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the Scheduling service. It registers static routes to serve
 * Scheduling-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module SchedulingViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers Scheduling service views with the Express application.
 * Sets up static file serving for Scheduling-related view templates and assets.
 * This function integrates the Scheduling service views into the main Express
 * application by mounting static file middleware at the '/services/Scheduling' route.
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} _eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} cache - The Scheduling service provider instance
 * @returns {void}
 *
 * @example
 * const express = require('express');
 * const app = express();
 * const SchedulingViews = require('./src/Scheduling/views');
 *
 * SchedulingViews({
 *   'express-app': app
 * }, eventEmitter, cacheService);
 */
module.exports = (options, eventEmitter, cache) => {
  if (options['express-app']) {
    const app = options['express-app'];


    /**
     * GET /services/Scheduling/scripts
     * Serves the client-side Scheduling library as JavaScript
     * This endpoint returns the nooblyjsScheduling library for use in web applications.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     * @example
     * // Include in HTML:
     * <script src="/services/Scheduling/scripts"></script>
     *
     * // Use in JavaScript:
     * const cache = new nooblyjsScheduling({ instanceName: 'default' });
     * cache.put('key', { data: 'value' });
     * cache.get('key').then(data => console.log(data));
     */
    app.get('/services/scheduling/scripts', (req, res) => {
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
        eventEmitter.emit('api-Scheduling-scripts-error', error.message);
        res.status(500).json({ error: 'Failed to load Scheduling library' });
      }
    });

 

    // Raise an event advising that the script library has loaded
    eventEmitter.emit('scheduling:loading scripts', {
      folder: path.join(__dirname),
    });
  }
};
