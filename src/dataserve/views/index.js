/**
 * @fileoverview Dataserve service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the dataserve service. It registers static routes to serve
 * dataserve-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module DataserveViews
 */

'use strict';

const express = require('express');
const path = require('path');

/**
 * Registers dataserve service views with the Express application.
 * Sets up static file serving for dataserve-related view templates and assets.
 * This function integrates the dataserve service views into the main Express
 * application by mounting static file middleware at the '/services/dataserve' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} dataserve - The dataserve service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const dataserveViews = require('./src/dataserve/views');
 * 
 * dataserveViews({
 *   'express-app': app
 * }, eventEmitter, dataserveService);
 */
module.exports = (options, eventEmitter, dataserve) => {
  if (options['express-app'] && dataserve) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for dataserve service
    app.use('/services/dataserve', express.static(path.join(__dirname)));
  }
};