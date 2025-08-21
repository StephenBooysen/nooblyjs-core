/**
 * @fileoverview Measuring service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the measuring service. It registers static routes to serve
 * measuring-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module MeasuringViews
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * Registers measuring service views with the Express application.
 * Sets up static file serving for measuring-related view templates and assets.
 * This function integrates the measuring service views into the main Express
 * application by mounting static file middleware at the '/services/measuring' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} measuring - The measuring service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const measuringViews = require('./src/measuring/views');
 * 
 * measuringViews({
 *   'express-app': app
 * }, eventEmitter, measuringService);
 */
module.exports = (options, eventEmitter, measuring) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for measuring service
    app.use('/services/measuring', express.static(path.join(__dirname)));
  }
};