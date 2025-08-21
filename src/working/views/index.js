/**
 * @fileoverview Working service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the working service. It registers static routes to serve
 * working-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module WorkingViews
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * Registers working service views with the Express application.
 * Sets up static file serving for working-related view templates and assets.
 * This function integrates the working service views into the main Express
 * application by mounting static file middleware at the '/services/working' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} worker - The working service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const workingViews = require('./src/working/views');
 * 
 * workingViews({
 *   'express-app': app
 * }, eventEmitter, workingService);
 */
module.exports = (options, eventEmitter, worker) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for working service
    app.use('/services/working', express.static(path.join(__dirname)));
  }
};