/**
 * @fileoverview Searching service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the searching service. It registers static routes to serve
 * searching-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module SearchingViews
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * Registers searching service views with the Express application.
 * Sets up static file serving for searching-related view templates and assets.
 * This function integrates the searching service views into the main Express
 * application by mounting static file middleware at the '/services/searching' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} search - The searching service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const searchingViews = require('./src/searching/views');
 * 
 * searchingViews({
 *   'express-app': app
 * }, eventEmitter, searchingService);
 */
module.exports = (options, eventEmitter, search) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for searching service
    app.use('/services/searching', express.static(path.join(__dirname)));
  }
};