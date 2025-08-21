/**
 * @fileoverview Filing service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the filing service. It registers static routes to serve
 * filing-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module FilingViews
 */

'use strict';

const path = require('path');
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
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} filing - The filing service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const filingViews = require('./src/filing/views');
 * 
 * filingViews({
 *   'express-app': app
 * }, eventEmitter, filingService);
 */
module.exports = (options, eventEmitter, filing) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for filing service
    app.use('/services/filing', express.static(path.join(__dirname)));
  }
};