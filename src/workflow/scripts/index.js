/**
 * @fileoverview workflow service views module for nooblyjs-core framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the workflow service. It registers static routes to serve
 * workflow-related view files and templates through the Express application.
 * 
 * @author NooblyJS
 * @version 1.0.14
 * @since 1.0.0
 * @module workflowViews
 */

'use strict';

const path = require('node:path');
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
 * @param {Object} _eventEmitter - Event emitter instance for inter-service communication
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


    /**
     * GET /services/workflow/scripts
     * Serves the client-side workflow library as JavaScript
     * This endpoint returns the WorkflowManagerUI library for use in web applications.
     *
     * @param {express.Request} req - Express request object
     * @param {express.Response} res - Express response object
     * @return {void}
     * @example
     * // Include in HTML:
     * <script src="/services/workflow/scripts"></script>
     *
     * // Use in JavaScript:
     * new WorkflowManagerUI({ containerId: 'workflowManager' }).initialize();
     */
    app.get('/services/workflow/scripts', (req, res) => {
      const fs = require('node:fs');
      const path = require('node:path');

      try {
        // Read the client library file
        const libraryPath = path.join(__dirname, './js/index.js');
        const libraryCode = fs.readFileSync(libraryPath, 'utf8');

        // Set appropriate headers for JavaScript
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        res.status(200).send(libraryCode);
      } catch (error) {
        eventEmitter.emit('api-workflow-scripts-error', error.message);
        res.status(500).json({ error: 'Failed to load workflow library' });
      }
    });



    // Raise an event advising that the script library has loaded
    eventEmitter.emit('workflow:loading scripts', {
      folder: path.join(__dirname),
    });
  }
};
