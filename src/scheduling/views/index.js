/**
 * @fileoverview Scheduling service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the scheduling service. It registers static routes to serve
 * scheduling-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module SchedulingViews
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Registers scheduling service views with the Express application.
 * Sets up static file serving for scheduling-related view templates and assets.
 * This function integrates the scheduling service views into the main Express
 * application by mounting static file middleware at the '/services/scheduling' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} scheduler - The scheduling service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const schedulingViews = require('./src/scheduling/views');
 * 
 * schedulingViews({
 *   'express-app': app
 * }, eventEmitter, schedulingService);
 */
module.exports = (options, eventEmitter, scheduler) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for scheduling service
    app.use('/services/scheduling', express.static(path.join(__dirname)));

    // Serve the schedule manager UI library by its static path, e.g.
    // /services/scheduling/scripts/js/index.js. Only the `js` folder is
    // exposed; the server-side route module next to it must not be served.
    app.use('/services/scheduling/scripts/js',
      express.static(path.join(__dirname, '../scripts/js')));
  }
};