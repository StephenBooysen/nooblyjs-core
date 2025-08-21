/**
 * @fileoverview Queueing service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the queueing service. It registers static routes to serve
 * queueing-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module QueueingViews
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * Registers queueing service views with the Express application.
 * Sets up static file serving for queueing-related view templates and assets.
 * This function integrates the queueing service views into the main Express
 * application by mounting static file middleware at the '/services/queueing' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} queue - The queueing service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const queueingViews = require('./src/queueing/views');
 * 
 * queueingViews({
 *   'express-app': app
 * }, eventEmitter, queueingService);
 */
module.exports = (options, eventEmitter, queue) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for queueing service
    app.use('/services/queueing', express.static(path.join(__dirname)));
  }
};