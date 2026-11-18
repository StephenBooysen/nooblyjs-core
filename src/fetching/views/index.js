/**
 * @fileoverview Fetching service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving
 * capabilities for the fetching service. It registers static routes to serve
 * fetching-related view files and templates through the Express application.
 *
 * @author NooblyJS
 * @version 1.0.0
 * @since 1.0.0
 * @module FetchingViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers fetching service views with the Express application.
 * Sets up static file serving for fetching-related view templates and assets.
 * This function integrates the fetching service views into the main Express
 * application by mounting static file middleware at the '/services/fetching' route.
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} _eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} fetching - The fetching service provider instance
 * @returns {void}
 *
 * @example
 * const express = require('express');
 * const app = express();
 * const fetchingViews = require('./src/fetching/views');
 *
 * fetchingViews({
 *   'express-app': app
 * }, eventEmitter, fetchingService);
 */
module.exports = (options, eventEmitter, fetching) => {
  if (options['express-app']) {
    const app = options['express-app'];

    // Serve static files from the views directory for fetching service
    app.use('/services/fetching', express.static(path.join(__dirname)));

    eventEmitter.emit('fetching:loading view', {
      folder: path.join(__dirname),
    });
  }
};
