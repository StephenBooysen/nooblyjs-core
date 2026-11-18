/**
 * @fileoverview DataService service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the dataservice service. It registers static routes to serve
 * dataservice-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module DataServiceViews
 */

'use strict';

const express = require('express');
const path = require('node:path');

/**
 * Registers dataservice service views with the Express application.
 * Sets up static file serving for dataservice-related view templates and assets.
 * This function integrates the dataservice service views into the main Express
 * application by mounting static file middleware at the '/services/dataservice' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} dataservice - The dataservice service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const dataserviceViews = require('./src/dataservice/views');
 * 
 * dataserviceViews({
 *   'express-app': app
 * }, eventEmitter, dataserviceService);
 */
module.exports = (options, eventEmitter, dataservice) => {
  if (options['express-app'] && dataservice) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for dataservice service
    app.use('/services/dataservice', express.static(path.join(__dirname)));
  }
};