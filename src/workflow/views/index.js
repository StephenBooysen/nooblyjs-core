/**
 * @fileoverview Workflow service views module for noobly-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the workflow service. It registers static routes to serve
 * workflow-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module WorkflowViews
 */

'use strict';

const path = require('path');
const express = require('express');

/**
 * Registers workflow service views with the Express application.
 * Sets up static file serving for workflow-related view templates and assets.
 * This function integrates the workflow service views into the main Express
 * application by mounting static file middleware at the '/services/workflow' route.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} workflow - The workflow service provider instance
 * @returns {void}
 * 
 * @example
 * const express = require('express');
 * const app = express();
 * const workflowViews = require('./src/workflow/views');
 * 
 * workflowViews({
 *   'express-app': app
 * }, eventEmitter, workflowService);
 */
module.exports = (options, eventEmitter, workflow) => {
  if (options['express-app']) {
    const app = options['express-app'];
    
    // Serve static files from the views directory for workflow service
    app.use('/services/workflow', express.static(path.join(__dirname)));
  }
};