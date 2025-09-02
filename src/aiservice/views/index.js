/**
 * @fileoverview ai service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the ai service. It registers static routes to serve
 * ai-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module CachingViews
 */

'use strict';

const path = require('path');
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
 * const cachingViews = require('./src/aiservice/views');
 *
 * cachingViews({
 *   'express-app': app
 * }, eventEmitter, aiService);
 */
module.exports = (options, eventEmitter, ai) => {
  if (options['express-app']) {
    const app = options['express-app'];

    // Serve static files from the views directory for caching service
    app.use('/services/ai', express.static(path.join(__dirname)));

    eventEmitter.emit('ai:loading view', {
      folder: path.join(__dirname),
    });
  }
};
