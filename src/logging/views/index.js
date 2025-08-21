/**
 * @fileoverview Logging service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the logging service. It registers static routes to serve
 * logging-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module LoggingViews
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * Registers logging service views with the Express application.
 * Sets up static file serving for logging-related view templates and assets.
 * This function integrates the logging service views into the main Express
 * application by mounting static file middleware at the '/services/logging' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} logger - The logging service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const loggingViews = require('./src/logging/views');
 * 
 * loggingViews({
 *   'express-app': app
 * }, eventEmitter, loggingService);
 */
module.exports = (options, eventEmitter, logger) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for logging service
    app.use('/services/logging', express.static(path.join(__dirname)));
  }
};